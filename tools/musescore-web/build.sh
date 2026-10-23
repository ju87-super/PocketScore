#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
report_dir="${MUSESCORE_REPORT_DIR:-reports/wasm}"
phase=preflight
log_file=""
mkdir -p "$report_dir"
finish() {
  local result=$?
  trap - EXIT
  set +e
  node "$script_dir/build-report.mjs" "$phase" "$result" "$report_dir" "$log_file"
  local report_result=$?
  if [ "$result" -eq 0 ]; then result=$report_result; fi
  exit "$result"
}
trap finish EXIT
source_dir="${MUSESCORE_SOURCE:?Set MUSESCORE_SOURCE}"
build_dir="${MUSESCORE_BUILD:?Set MUSESCORE_BUILD}"
output_dir="${MUSESCORE_WEB_OUTPUT:?Set MUSESCORE_WEB_OUTPUT}"
qt_root="${QT_ROOT_DIR:?Qt for WebAssembly must be installed}"
expected=3654226c2e99289916916953a98e585a3d3b315a
actual="$(git -C "$source_dir" rev-parse HEAD)"
if [ "$actual" != "$expected" ]; then echo "Expected MuseScore $expected, found $actual" >&2; exit 1; fi
if [ ! -f "$qt_root/lib/cmake/Qt6/qt.toolchain.cmake" ]; then echo "Missing Qt WASM toolchain in $qt_root" >&2; exit 1; fi
mkdir -p "$build_dir" "$output_dir"
phase=toolchain
log_file="$report_dir/emscripten.log"
emcc --version 2>&1 | tee "$log_file"
test "$(emcc -dumpversion)" = '4.0.7'
log_file="$report_dir/qt-version.log"
cmake -P "$script_dir/verify-qt.cmake" 2>&1 | tee "$log_file"
cmake --version | tee "$report_dir/cmake.log"
node --version | tee "$report_dir/node.log"
printf '#include <stdio.h>\nint main(void){puts("EMSCRIPTEN_OK");return 0;}\n' > "$report_dir/toolchain.c"
log_file="$report_dir/toolchain-compile.log"
emcc "$report_dir/toolchain.c" -o "$report_dir/toolchain.js" -sWASM_ASYNC_COMPILATION=0 2>&1 | tee "$log_file"
log_file="$report_dir/toolchain-execution.log"
node "$report_dir/toolchain.js" 2>&1 | tee "$log_file"
grep -q EMSCRIPTEN_OK "$log_file"
phase=configure
log_file="$report_dir/configure.log"
cmake -S "$source_dir" -B "$build_dir" -GNinja \
  -DCMAKE_TOOLCHAIN_FILE="$qt_root/lib/cmake/Qt6/qt.toolchain.cmake" \
  -DCMAKE_PREFIX_PATH="$qt_root" -DCMAKE_BUILD_TYPE=Release \
  -DMUSESCORE_BUILD_CONFIGURATION=app-web -DMUSE_APP_BUILD_MODE=dev \
  -DMUSE_COMPILE_USE_UNITY=OFF -DMUSE_ENABLE_UNIT_TESTS=OFF \
  2>&1 | tee "$log_file"
phase=compile
log_file="$report_dir/build.log"
cmake --build "$build_dir" --parallel 2 2>&1 | tee "$log_file"
phase=artifacts
log_file=""
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
node "$script_dir/probe.mjs" "$output_dir" --json > "$report_dir/static.json"
phase=complete
