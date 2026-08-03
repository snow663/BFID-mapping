# Android APK Build Status

- Result: **cancelled**
- Application branch: `agent/initial-local-first-mapping-app`
- Source commit: `f24a36eefa81769ffc36b31d4b404ac6f4967267`
- Workflow run: https://github.com/snow663/BFID-mapping/actions/runs/30850503584
- Finished: 2026-08-03 20:32:23 UTC

## Build log tail
```text

> bfid-mapping@0.1.0 tauri
> tauri android build --debug --apk --target aarch64 --target armv7 --ci

        Info Using installed NDK: /usr/local/lib/android/sdk/ndk/28.2.13676358
        Info Looking up installed tauri packages to check mismatched versions...
     Running beforeBuildCommand `npm run build`

> bfid-mapping@0.1.0 build
> vite build

8:31:48 PM [vite-plugin-svelte] no Svelte config found at /home/runner/work/BFID-mapping/BFID-mapping - using default configuration.
[36mvite v7.3.6 [32mbuilding client environment for production...[36m[39m
transforming...
[32m✓[39m 154 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/[22m[32mindex.html                 [39m[1m[2m    4.39 kB[22m[1m[22m[2m │ gzip:   1.66 kB[22m
[2mdist/[22m[2massets/[22m[35mstyle-QOI7oxF7.css  [39m[1m[2m   85.96 kB[22m[1m[22m[2m │ gzip:  14.23 kB[22m
[2mdist/[22m[2massets/[22m[36mindex-CbcjgQPF.js   [39m[1m[33m2,245.08 kB[39m[22m[2m │ gzip: 481.87 kB[22m[2m │ map: 3,774.84 kB[22m
[32m✓ built in 7.24s[39m
[1m[92m    Updating[0m crates.io index
[1m[92m     Locking[0m 466 packages to latest compatible versions
[1m[92m      Adding[0m generic-array v0.14.7 [1m[33m(available: v0.14.9)[0m
[1m[92m      Adding[0m toml v0.8.2 [1m[33m(available: v0.8.23)[0m
[1m[92m      Adding[0m toml_datetime v0.6.3 [1m[33m(available: v0.6.11)[0m
[1m[92m      Adding[0m toml_edit v0.20.2 [1m[33m(available: v0.20.7)[0m
[1m[92m   Compiling[0m tauri v2.11.5
[1m[92m   Compiling[0m wry v0.55.1
[1m[92m   Compiling[0m bfid-mapping v0.1.0 (/home/runner/work/BFID-mapping/BFID-mapping/src-tauri)
[1m[92m   Compiling[0m tauri-plugin-notification v2.3.3
[1m[92m   Compiling[0m tauri-plugin-geolocation v2.3.2
[1m[92m   Compiling[0m tauri-runtime-wry v2.11.4
[1m[92m    Finished[0m `dev` profile [unoptimized + debuginfo] target(s) in 17.76s
        Info symlinking lib "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so" in jniLibs dir "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
        Info "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so" requires shared lib "libandroid.so"
        Info "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so" requires shared lib "libdl.so"
        Info "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so" requires shared lib "liblog.so"
        Info "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so" requires shared lib "libm.so"
        Info "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so" requires shared lib "libc.so"
        Info symlink at "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libbfid_mapping_lib.so" points to "/home/runner/work/BFID-mapping/BFID-mapping/src-tauri/target/aarch64-linux-android/debug/libbfid_mapping_lib.so"
Downloading https://services.gradle.org/distributions/gradle-8.14.3-bin.zip
.............10%.............20%.............30%.............40%.............50%.............60%.............70%.............80%.............90%..............100%
```
