from .conftest import booking_body, jpeg_bytes


def test_admin_requires_login(client):
    assert client.get("/api/admin/bookings").status_code == 401
    assert client.post("/api/admin/login", json={"password": "wrong"}).status_code == 401


def test_login_attempts_are_limited(client):
    codes = [client.post("/api/admin/login", json={"password": "x"}).status_code for _ in range(6)]
    assert codes[-1] == 429


def test_logout(admin):
    assert admin.get("/api/admin/me").status_code == 200
    admin.post("/api/admin/logout")
    assert admin.get("/api/admin/me").status_code == 401


def test_bookings_list_and_status_change(admin, tg, free):
    d, t = free
    admin.post("/api/bookings", json=booking_body(d, t))
    items = admin.get("/api/admin/bookings").json()
    assert len(items) == 1 and items[0]["status"] == "new" and items[0]["notified"]
    r = admin.patch(f"/api/admin/bookings/{items[0]['id']}", json={"status": "confirmed"})
    assert r.json()["status"] == "confirmed"
    assert "подтверждена" in tg.sent("editMessageText")[-1]["text"]
    assert admin.delete(f"/api/admin/bookings/{items[0]['id']}").status_code == 200
    assert admin.get("/api/admin/bookings?scope=all").json() == []


def test_schedule_and_blocked_days(admin):
    sched = admin.get("/api/admin/schedule").json()
    sched.update(slot_times=["18:00", "10:00"], weekdays=[0, 6])
    sched.pop("blocked")
    r = admin.put("/api/admin/schedule", json=sched)
    assert r.status_code == 200 and r.json()["slot_times"] == ["10:00", "18:00"]
    slots = admin.get("/api/slots").json()
    assert slots["times"] == ["10:00", "18:00"]
    day = next(iter(slots["slots"]))
    assert all(times == ["10:00", "18:00"] for times in slots["slots"].values())

    admin.post("/api/admin/blocked", json={"date": day})
    assert day not in admin.get("/api/slots").json()["slots"]
    admin.delete(f"/api/admin/blocked?date={day}")
    admin.post("/api/admin/blocked", json={"date": day, "time": "10:00"})
    assert admin.get("/api/slots").json()["slots"][day] == ["18:00"]

    bad = admin.put("/api/admin/schedule", json={**sched, "slot_times": ["25:00"]})
    assert bad.status_code == 400


def test_packages_crud_shows_on_site(admin):
    pkgs = admin.get("/api/admin/packages").json()
    minimal = next(p for p in pkgs if p["id"] == "minimal")
    minimal.update(photos="25 фото", features=["1 час съёмки", "25 обработанных фото"], price=5500)
    assert admin.put("/api/admin/packages/minimal", json=minimal).status_code == 200

    r = admin.post("/api/admin/packages", json={"name": "Подарочный сертификат", "price": 9000, "features": []})
    assert r.status_code == 201
    new_id = r.json()["id"]
    site = admin.get("/api/content").json()["packages"]
    assert site[0]["price"] == 5500 and site[0]["photos"] == "25 фото" and site[-1]["id"] == new_id

    admin.post("/api/admin/packages/reorder", json={"ids": [new_id, "minimal", "standard", "maximal"]})
    assert admin.get("/api/content").json()["packages"][0]["id"] == new_id

    hidden = {**r.json(), "active": False}
    admin.put(f"/api/admin/packages/{new_id}", json=hidden)
    assert new_id not in [p["id"] for p in admin.get("/api/content").json()["packages"]]
    assert admin.delete(f"/api/admin/packages/{new_id}").status_code == 200


def test_booking_keeps_price_snapshot(admin, free):
    d, t = free
    admin.post("/api/bookings", json=booking_body(d, t))
    std = next(p for p in admin.get("/api/admin/packages").json() if p["id"] == "standard")
    admin.put("/api/admin/packages/standard", json={**std, "price": 12000})
    assert admin.get("/api/admin/bookings").json()[0]["packagePrice"] == 9000


def test_portfolio_series_and_photo_upload(admin):
    from app.config import settings

    s = admin.post("/api/admin/series", json={"title": "У озера", "description": "Вода и туман"}).json()
    r = admin.post(f"/api/admin/series/{s['id']}/photos",
                   files=[("files", ("a.jpg", jpeg_bytes(), "image/jpeg")),
                          ("files", ("bad.txt", b"not an image", "text/plain"))])
    body = r.json()
    assert r.status_code == 201 and len(body["added"]) == 1 and len(body["errors"]) == 1
    photo = body["added"][0]
    assert (photo["w"], photo["h"]) == (2400, 1600)
    full = settings.media_dir / photo["src"].removeprefix("/media/")
    small = settings.media_dir / photo["srcSm"].removeprefix("/media/")
    from PIL import Image
    assert max(Image.open(full).size) == 1800 and max(Image.open(small).size) == 900

    site = admin.get("/api/content").json()["series"]
    assert [x["title"] for x in site] == ["Лес и туман", "У озера"]

    admin.patch(f"/api/admin/photos/{photo['id']}", json={"alt": "Туман над озером"})
    assert admin.get("/api/content").json()["series"][1]["photos"][0]["alt"] == "Туман над озером"

    admin.delete(f"/api/admin/series/{s['id']}")
    assert not full.exists() and not small.exists()
    assert len(admin.get("/api/content").json()["series"]) == 1
