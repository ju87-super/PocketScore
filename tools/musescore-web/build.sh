#!/usr/bin/env bash
set -euo pipefail
source_dir="${MUSESCORE_SOURCE:?Set MUSESCORE_SOURCE}"
build_dir="${MUSESCORE_BUILD:?Set MUSESCORE_BUILD}"
output_dir="${MUSESCORE_WEB_OUTPUT:?Set MUSESCORE_WEB_OUTPUT}"
qt_root="${QT_ROOT_DIR:?Qt for WebAssembly must be installed}"
expected=3654226c2e99289916916953a98e585a3d3b315a
test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected"
test -f "$qt_root/lib/cmake/Qt6/qt.toolchain.cmake"
mkdir -p reports/wasm "$build_dir" "$output_dir"
emcc --version | tee reports/wasm/emscripten.log
test "$(emcc -dumpversion)" = '4.0.7'
node -e 'const fs=require("node:fs"); if(!fs.readFileSync(process.env.QT_ROOT_DIR+"/lib/cmake/Qt6Core/Qt6CoreConfigVersion.cmake","utf8").includes("6.10.2")) process.exit(1)'
cmake --version | tee reports/wasm/cmake.log
node --version | tee reports/wasm/node.log
printf '#include <stdio.h>\nint main(void){puts("EMSCRIPTEN_OK");return 0;}\n' > reports/wasm/toolchain.c
emcc reports/wasm/toolchain.c -o reports/wasm/toolchain.js -sWASM_ASYNC_COMPILATION=0
node reports/wasm/toolchain.js | tee reports/wasm/toolchain-execution.log
grep -q EMSCRIPTEN_OK reports/wasm/toolchain-execution.log
cmake -S "$source_dir" -B "$build_dir" -GNinja \
  -DCMAKE_TOOLCHAIN_FILE="$qt_root/lib/cmake/Qt6/qt.toolchain.cmake" \
  -DCMAKE_PREFIX_PATH="$qt_root" -DCMAKE_BUILD_TYPE=Release \
  -DMUSESCORE_BUILD_CONFIGURATION=app-web -DMUSE_APP_BUILD_MODE=dev \
  -DMUSE_COMPILE_USE_UNITY=OFF -DMUSE_ENABLE_UNIT_TESTS=OFF \
  2>&1 | tee reports/wasm/configure.log
cmake --build "$build_dir" --parallel 2 2>&1 | tee reports/wasm/build.log
artifact="$(find "$build_dir" -name MuseScoreStudio.wasm -type f -print -quit)"
test -n "$artifact"
cp -a "$(dirname "$artifact")/." "$output_dir/"
# The upstream JS installer logs copy errors without failing; verify/fill the
# actual licensed asset from this exact source tree, never a placeholder bank.
mkdir -p "$output_dir/sound"
cp "$source_dir/share/sound/MS Basic.sf3" "$output_dir/sound/MS Basic.sf3"
cp "$source_dir/share/sound/MS Basic_License.md" "$output_dir/sound/MS Basic_License.md"
cp "$source_dir/LICENSE.txt" "$output_dir/MuseScore-LICENSE.txt"
printf 'Source: https://github.com/musescore/MuseScore/tree/%s\nUnmodified GPL-3.0-only upstream build; see MuseScore-LICENSE.txt.\nQt 6.10.2 / Emscripten 4.0.7. Runtime results are reported separately.\n' "$expected" > "$output_dir/SOURCE.txt"
node tools/musescore-web/probe.mjs "$output_dir" --json > reports/wasm/static.json
