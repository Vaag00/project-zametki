# VAAAAAAG — фоткает

Одностраничный лендинг фотографа: React 19 + TypeScript + Vite, Tailwind CSS v4, motion, lucide-react.
Страница высотой 650vh — скролл перематывает два фоновых видео, текст растворяется, выезжают панели с пакетами.

```bash
cd landing
npm install
npm run dev      # http://localhost:5173
npm run build    # сборка в landing/dist
```

## Свои материалы

Замените файлы в `landing/public/` (имена оставьте прежними):

| Файл | Что это |
|------|---------|
| `video1.mp4`, `video2.mp4` | фоновые видео (сейчас — собраны из фотографий) |
| `video1.webm`, `video2.webm` | те же видео в WebM — необязательно; если заменили только `.mp4`, удалите `.webm`, иначе браузер покажет старую заглушку |
| `hero.jpg` | портрет для карточки на первом экране (4:5) |
| `series1.jpg`, `series2.jpg` | фото для панелей |
| `logo.svg` | монограмма «V» |

Для плавной перемотки видео кодируйте его с частыми ключевыми кадрами, например:

```bash
ffmpeg -i in.mp4 -an -c:v libx264 -crf 23 -g 6 -movflags +faststart video1.mp4
```

Весь код — в `src/App.tsx`, шрифты и скроллбар — в `src/index.css`.
