# Meliviny

Meliviny is a personal, local-first music platform delivered as a static progressive web app. It supports browser-local music sources and optional public personal-server metadata.

## Architecture

- Semantic HTML, modular CSS, and vanilla JavaScript
- IndexedDB for library metadata, settings, queue, playback position, and history
- Browser File System Access API or file-picker fallback for local music
- Native `HTMLAudioElement` and optional Web Audio API processing
- Public `library.json` manifest integration for GitHub Release audio assets
- Optional Firebase Authentication and Firestore metadata synchronization
- Versioned service worker for the application shell only

Firebase never stores or streams music files. Local files, filesystem handles, and blob URLs remain on the device.

## Local development

Serve the repository over HTTP or HTTPS because ES modules, service workers, and filesystem APIs are restricted when opening files directly:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/` in a supported browser.

## GitHub Pages deployment

The site is static and deploys from the `main` branch to GitHub Pages. No Node runtime, server-side rendering, API routes, or environment variables are required.

## Firebase configuration

The public web client configuration is in `js/config.js`. Enable Email/Password Authentication in Firebase, deploy `firestore.rules`, and configure the GitHub Pages origin in Firebase Authentication. Firestore data is scoped under `users/{uid}` and protected by owner-only rules.

Firebase synchronization is optional. If Firebase cannot load or the user is signed out, local mode continues to work.

## Server library format

The configured server source expects a public JSON manifest, typically at a GitHub Release URL such as `library.json`:

```json
{
	"version": 1,
	"tracks": [
		{
			"id": "stable-track-id",
			"title": "Track title",
			"artists": ["Artist"],
			"album": "Album",
			"audioUrl": "https://github.com/.../releases/download/.../track.mp3"
		}
	]
}
```

Audio is streamed by the browser. The application does not download or cache the complete server library.

## PWA behavior

The service worker caches HTML, CSS, JavaScript, icons, and metadata needed for the shell. It does not cache MP3, WAV, FLAC, WebM, or other large audio assets. Updates are detected and offered through an explicit update control. Install prompts appear only when the browser provides them.

## Browser limitations

- Directory handles require a secure context and a browser supporting the File System Access API.
- File-picker fallback does not provide persistent folder permissions after reload.
- FLAC, WebM, Media Session, Web Audio, Web Share, and install prompts depend on browser/platform support.
- Public server streaming requires network access and appropriate CORS/HTTP range support.
- Firebase authentication and sync require Firebase project configuration and enabled provider settings.

## Known limitations

Metadata extraction from local files is currently conservative and primarily filename-based. Playlist editing, offline server audio downloads, external social sharing APIs, and a native audio cache are intentionally not implemented.
