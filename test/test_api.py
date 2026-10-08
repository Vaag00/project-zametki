# ---------------- Авторизация ----------------

def test_register_returns_user_and_creates_session(client):
    r = client.post("/api/auth/register",
                    json={"username": "Папа_2026", "password": "secret-password"})
    assert r.status_code == 201
    body = r.json()
    assert body["username"] == "Папа_2026"
    assert "id" in body
    # Сессия сразу активна — /me работает без повторного входа
    assert client.get("/api/auth/me").json() == body


def test_register_creates_welcome_note(client):
    client.post("/api/auth/register",
                json={"username": "newbie", "password": "secret-password"})
    notes = client.get("/api/notes").json()
    assert len(notes) == 1
    assert notes[0]["pinned"] is True
    assert notes[0]["color"] == "yellow"
    assert notes[0]["tags"] == ["инструкция"]


def test_register_short_password_rejected(client):
    r = client.post("/api/auth/register",
                    json={"username": "shorty", "password": "123"})
    assert r.status_code == 422
    assert "не короче 8" in r.json()["detail"]


def test_register_invalid_username_rejected(client):
    for bad in ["ab", "a" * 31, "плохой логин!", "x y"]:
        r = client.post("/api/auth/register",
                        json={"username": bad, "password": "secret-password"})
        assert r.status_code == 422, bad


def test_register_duplicate_username_case_insensitive(client):
    client.post("/api/auth/register",
                json={"username": "Папа", "password": "secret-password"})
    r = client.post("/api/auth/register",
                    json={"username": "папа", "password": "secret-password"})
    assert r.status_code == 409
    assert "занят" in r.json()["detail"]


def test_login_success_and_me(client):
    client.post("/api/auth/register",
                json={"username": "loginner", "password": "secret-password"})
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login",
                    json={"username": "LogInner", "password": "secret-password"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").json()["username"] == "loginner"


def test_login_wrong_password(client):
    client.post("/api/auth/register",
                json={"username": "victim", "password": "secret-password"})
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login",
                    json={"username": "victim", "password": "wrong-pass-1"})
    assert r.status_code == 401
    # И для несуществующего пользователя — тоже 401 (DUMMY_HASH)
    r2 = client.post("/api/auth/login",
                     json={"username": "no_such_user", "password": "wrong-pass-1"})
    assert r2.status_code == 401


def test_me_without_session(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_invalidates_session(client):
    client.post("/api/auth/register",
                json={"username": "out", "password": "secret-password"})
    assert client.get("/api/auth/me").status_code == 200
    r = client.post("/api/auth/logout")
    assert r.status_code == 204
    assert client.get("/api/auth/me").status_code == 401


# ---------------- Заметки ----------------

def test_create_note_defaults(user_alice):
    r = user_alice.post("/api/notes", json={"title": "Пустышка"})
    assert r.status_code == 201
    note = r.json()
    assert note["body"] == ""
    assert note["tags"] == []
    assert note["color"] == "default"
    assert note["pinned"] is False
    assert note["archived"] is False


def test_create_note_tags_are_cleaned(user_alice, alice_note):
    # "Дом" -> "дом", дубликат "дом" убран, " еда " обрезано
    assert alice_note["tags"] == ["дом", "еда"]


def test_list_notes_sorted_by_updated_desc(user_alice):
    user_alice.post("/api/notes", json={"title": "первая"})
    user_alice.post("/api/notes", json={"title": "вторая"})
    titles = [n["title"] for n in user_alice.get("/api/notes").json()]
    assert titles[:2] == ["вторая", "первая"]  # приветственная заметка — третья


def test_patch_partial_updates_only_given_fields(user_alice, alice_note):
    note_id = alice_note["id"]
    r = user_alice.patch(f"/api/notes/{note_id}", json={"pinned": True})
    assert r.status_code == 200
    updated = r.json()
    assert updated["pinned"] is True
    assert updated["title"] == "Покупки"      # не тронуто
    assert updated["color"] == "default"      # не тронуто
    assert updated["createdAt"] == alice_note["createdAt"]
    assert updated["updatedAt"] >= alice_note["updatedAt"]


def test_patch_note_not_found(user_alice):
    r = user_alice.patch("/api/notes/" + "f" * 32, json={"title": "x"})
    assert r.status_code == 404


def test_soft_delete_and_restore(user_alice, alice_note):
    note_id = alice_note["id"]
    assert user_alice.delete(f"/api/notes/{note_id}").status_code == 204
    # После удаления заметки нет в списке
    ids = [n["id"] for n in user_alice.get("/api/notes").json()]
    assert note_id not in ids
    # Но её можно восстановить
    r = user_alice.post(f"/api/notes/{note_id}/restore")
    assert r.status_code == 200
    assert r.json()["title"] == "Покупки"
    ids = [n["id"] for n in user_alice.get("/api/notes").json()]
    assert note_id in ids


def test_restore_not_deleted_note_fails(user_alice, alice_note):
    r = user_alice.post(f"/api/notes/{alice_note['id']}/restore")
    assert r.status_code == 404


def test_delete_already_deleted_returns_404(user_alice, alice_note):
    note_id = alice_note["id"]
    user_alice.delete(f"/api/notes/{note_id}")
    assert user_alice.delete(f"/api/notes/{note_id}").status_code == 404


def test_notes_are_isolated_between_users(user_alice, user_bob, alice_note):
    # Боб не видит заметок Алисы
    assert user_bob.get("/api/notes").json() == []
    # и не может их ни редактировать, ни удалить, ни восстановить
    nid = alice_note["id"]
    assert user_bob.patch(f"/api/notes/{nid}", json={"title": "взлом"}).status_code == 404
    assert user_bob.delete(f"/api/notes/{nid}").status_code == 404
    assert user_bob.post(f"/api/notes/{nid}/restore").status_code == 404
    # А заметка Алисы при этом нетронута
    assert user_alice.get("/api/notes").json()[0]["title"] == "Покупки"


def test_notes_require_auth(client):
    assert client.get("/api/notes").status_code == 401
    assert client.post("/api/notes", json={"title": "x"}).status_code == 401


def test_note_validation_limits(user_alice):
    r = user_alice.post("/api/notes", json={"title": "t" * 121})
    assert r.status_code == 422
    r = user_alice.post("/api/notes", json={"tags": ["t"] * 21})
    assert r.status_code == 422
    r = user_alice.post("/api/notes", json={"color": "red"})
    assert r.status_code == 422  # цвета вне enum не принимаются