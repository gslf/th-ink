# Third-party components

The [MIT License](LICENSE) covers original th.ink code. It does not replace the
licenses of bundled dependencies.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Highlight.js | 11.11.1 | BSD-3-Clause | [Highlight.js](https://github.com/highlightjs/highlight.js) |
| CodeMirror / Lezer | Pinned in `package-lock.json` | MIT | [CodeMirror](https://github.com/codemirror) |
| vosk-browser / Vosk runtime | 0.0.8 | Apache-2.0 | [vosk-browser](https://github.com/ccoreilly/vosk-browser) |
| Italian speech model | vosk-model-small-it-0.22 | Apache-2.0 | [Vosk catalog](https://alphacephei.com/vosk/models) |
| English speech model | vosk-model-small-en-us-0.15 | Apache-2.0 | [Vosk catalog](https://alphacephei.com/vosk/models) |
| eSpeak NG / Emscripten | 0.3.5 | GPL-3.0 | [Echogarden](https://github.com/echogarden-project/espeak-ng-emscripten) |
| Filen SDK | 0.4.2 | AGPL-3.0 | [Filen](https://github.com/FilenCloudDienste/filen-sdk-ts) |
| emojibase-data | 18.0.0 | MIT | [Emojibase](https://github.com/milesj/emojibase) |
| minishlink/web-push | 10.1.0 | MIT | [Web Push PHP](https://github.com/web-push-libs/web-push-php) |

License texts are retained in `licenses/` and distributed dependency bundles.
Transitive dependencies keep their own notices. GPL and AGPL obligations still
apply when distributing those components; the project's MIT license does not
relicense them.

The Vosk runtime has a reproducible patch in `scripts/patch_vosk_csp.py` and
`scripts/voice-patches/`. It replaces dynamic JavaScript compilation with ordinary
closures. The WASM engine and model weights are unchanged. The eSpeak runtime
is unmodified. Upstream source is available through the links above.

Speech assets are pinned by version and checksum in `scripts/voice-lock.json`
and `src/models/manifest.json`. JavaScript and PHP dependencies are pinned in
`package-lock.json` and `server/composer.lock`. Runtime code is served locally;
no CDN is used during app operation.
