# Android APK Build Status

- Result: **cancelled**
- Application branch: `agent/initial-local-first-mapping-app`
- Source commit: `521d5321ba5d4578aea08f1820479d82c2598b3c`
- Workflow run: https://github.com/snow663/BFID-mapping/actions/runs/30843384596
- Finished: 2026-08-03 18:56:22 UTC

## Build log tail
```text

> bfid-mapping@0.1.0 tauri
> tauri android build --debug --apk --target aarch64 --target armv7 --ci

        Info Using installed NDK: /usr/local/lib/android/sdk/ndk/28.2.13676358
        Info Looking up installed tauri packages to check mismatched versions...
     Running beforeBuildCommand `npm run build`

> bfid-mapping@0.1.0 build
> vite build

6:55:57 PM [vite-plugin-svelte] no Svelte config found at /home/runner/work/BFID-mapping/BFID-mapping - using default configuration.
[36mvite v7.3.6 [32mbuilding client environment for production...[36m[39m
transforming...
[32m✓[39m 152 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/[22m[32mindex.html                 [39m[1m[2m    4.39 kB[22m[1m[22m[2m │ gzip:   1.65 kB[22m
[2mdist/[22m[2massets/[22m[35mstyle-QOI7oxF7.css  [39m[1m[2m   85.96 kB[22m[1m[22m[2m │ gzip:  14.23 kB[22m
[2mdist/[22m[2massets/[22m[36mindex-BzEdcy8h.js   [39m[1m[33m2,221.69 kB[39m[22m[2m │ gzip: 477.29 kB[22m[2m │ map: 3,728.01 kB[22m
[32m✓ built in 6.97s[39m
[1m[92m    Updating[0m crates.io index
[1m[92m     Locking[0m 466 packages to latest compatible versions
[1m[92m      Adding[0m generic-array v0.14.7 [1m[33m(available: v0.14.9)[0m
[1m[92m      Adding[0m toml v0.8.2 [1m[33m(available: v0.8.23)[0m
[1m[92m      Adding[0m toml_datetime v0.6.3 [1m[33m(available: v0.6.11)[0m
[1m[92m      Adding[0m toml_edit v0.20.2 [1m[33m(available: v0.20.7)[0m
[1m[92m Downloading[0m crates ...
[1m[92m  Downloaded[0m aho-corasick v1.1.5
[1m[92m  Downloaded[0m ipnet v2.12.1
[1m[92m  Downloaded[0m tauri-plugin-geolocation v2.3.2
[1m[92m  Downloaded[0m time v0.3.55
[1m[92m   Compiling[0m aho-corasick v1.1.5
[1m[92m   Compiling[0m time v0.3.55
[1m[92m   Compiling[0m regex-automata v0.4.16
[1m[92m   Compiling[0m plist v1.10.0
[1m[92m   Compiling[0m cookie v0.18.1
[1m[92m   Compiling[0m wry v0.55.1
[1m[92m   Compiling[0m ipnet v2.12.1
[1m[92m   Compiling[0m regex v1.13.1
[1m[92m   Compiling[0m urlpattern v0.3.0
[1m[92m   Compiling[0m tauri-utils v2.9.3
[1m[92m   Compiling[0m hyper-util v0.1.20
[1m[92m   Compiling[0m reqwest v0.13.4
[1m[92m   Compiling[0m tauri-runtime v2.11.3
[1m[92m   Compiling[0m tauri-runtime-wry v2.11.4
```
