#!/usr/bin/env bash
# Reproducible, offline device verification. Operates only on an already booted emulator.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/run-android-checklist.sh EMULATOR_SERIAL [OUTPUT_DIRECTORY]

The serial must identify a booted Android emulator (ro.kernel.qemu=1).
Runs local editor, large-media, export and recovery checks, followed by a
process-death/cold-reboot recovery check. Leaves the emulator offline.

Environment:
  SKIP_BUILD=1       Use the existing debug and debug-androidTest APKs.
  RUN_LOW_STORAGE=1  Also physically fill this emulator's /data, leave about
                    32 MiB, run the storage rejection test, and remove filler.
  CHECKLIST_CLASSES Space- or comma-separated class names to run; defaults to
                    all checklist classes. Example: 'LocalEditorChecklistTest
                    LocalExportChecklistTest'. Omitting
                    LocalProcessRecoveryChecklistTest skips the reboot.
  JAVA_HOME         Optional local JDK; otherwise autodetected.
  ANDROID_SDK_ROOT / ANDROID_HOME / ADB
                    Optional SDK directory or explicit adb executable.

The default evidence directory is a fresh directory under the host's temporary
directory. No release signing configuration or physical device is used.
USAGE
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
[[ $# -ge 1 && $# -le 2 ]] || { usage >&2; exit 2; }
SERIAL=$1
[[ -n "$SERIAL" && "$SERIAL" != -* && ! "$SERIAL" =~ [[:space:]] ]] || die 'Provide one explicit emulator serial.'
[[ ${SKIP_BUILD:-0} == 0 || ${SKIP_BUILD:-0} == 1 ]] || die 'SKIP_BUILD must be 0 or 1.'
[[ ${RUN_LOW_STORAGE:-0} == 0 || ${RUN_LOW_STORAGE:-0} == 1 ]] || die 'RUN_LOW_STORAGE must be 0 or 1.'
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ANDROID_PROJECT="$REPO_ROOT/Openreel Video Android"
if [[ $# == 2 ]]; then
  mkdir -p "$2"
  OUTPUT_DIR=$(cd "$2" && pwd)
else
  OUTPUT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/openreel-android-checklist.XXXXXX")
fi
printf 'Evidence: %s\n' "$OUTPUT_DIR"
DEFAULT_CHECKLIST_CLASSES='LocalEditorChecklistTest LocalLargeMediaChecklistTest LocalExportChecklistTest LocalLutFidelityChecklistTest LocalExportGeometryChecklistTest LocalHdrChecklistTest LocalRecoveryChecklistTest LocalProcessRecoveryChecklistTest'
class_selection=${CHECKLIST_CLASSES-$DEFAULT_CHECKLIST_CLASSES}
class_selection=${class_selection//,/ }
class_selection=${class_selection//$'\n'/ }
read -r -a selected_classes <<< "$class_selection"
[[ ${#selected_classes[@]} -gt 0 ]] || die 'CHECKLIST_CLASSES must select at least one checklist class.'
for checklist in "${selected_classes[@]}"; do
  checklist=${checklist#com.pythonxi.openreelvideo.}
  case "$checklist" in
    LocalEditorChecklistTest|LocalLargeMediaChecklistTest|LocalExportChecklistTest|LocalLutFidelityChecklistTest|LocalExportGeometryChecklistTest|LocalHdrChecklistTest|LocalRecoveryChecklistTest|LocalProcessRecoveryChecklistTest) ;;
    *) die "Unknown checklist class: $checklist" ;;
  esac
done
printf '%s\n' "${selected_classes[@]}" > "$OUTPUT_DIR/selected-classes.txt"

find_adb() {
  local candidate sdk_from_properties=''
  if [[ -n ${ADB:-} ]]; then
    [[ -x "$ADB" ]] || die 'ADB must name an executable.'
    printf '%s\n' "$ADB"; return
  fi
  if [[ -f "$ANDROID_PROJECT/local.properties" ]]; then
    sdk_from_properties=$(sed -n 's/^sdk\.dir=//p' "$ANDROID_PROJECT/local.properties" | head -n 1)
  fi
  for candidate in \
    "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
    "${ANDROID_HOME:-}/platform-tools/adb" \
    "$sdk_from_properties/platform-tools/adb" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb"; do
    if [[ -x "$candidate" ]]; then printf '%s\n' "$candidate"; return; fi
  done
  if command -v adb >/dev/null 2>&1; then command -v adb; return; fi
  die 'adb was not found. Set ANDROID_SDK_ROOT, ANDROID_HOME or ADB.'
}
ADB_BIN=$(find_adb)
ADB_COMMAND=("$ADB_BIN" -s "$SERIAL")
adb_device() { "${ADB_COMMAND[@]}" "$@"; }
assert_emulator() {
  [[ $(adb_device get-state 2>/dev/null | tr -d '\r') == device ]] || die "Emulator $SERIAL is not connected."
  [[ $(adb_device shell getprop ro.kernel.qemu | tr -d '\r') == 1 ]] || die 'Refusing to operate on a physical device (ro.kernel.qemu must equal 1).'
  [[ $(adb_device shell getprop sys.boot_completed | tr -d '\r') == 1 ]] || die 'Emulator must already be fully booted.'
}
assert_emulator

APP_PACKAGE=com.pythonxi.openreelvideo
TEST_PACKAGE=com.pythonxi.openreelvideo.test
RUNNER="$TEST_PACKAGE/androidx.test.runner.AndroidJUnitRunner"
FILLER_DIRECTORY=''
FILLER_FILE=''
LOGCAT_PID=''
INSTRUMENTATION_RUNNING=0

remove_filler() {
  [[ -n "$FILLER_DIRECTORY" ]] || return 0
  local attempt
  for attempt in 1 2 3; do
    if adb_device shell rm -f "$FILLER_FILE" && adb_device shell rmdir "$FILLER_DIRECTORY"; then
      FILLER_DIRECTORY=''; FILLER_FILE=''
      return 0
    fi
    printf 'Filler cleanup attempt %s failed; retrying.\n' "$attempt" >&2
    sleep 2
  done
  printf 'Could not remove emulator filler. Reconnect %s and run: adb -s %s shell rm -f %s\n' "$SERIAL" "$SERIAL" "$FILLER_FILE" >&2
  return 1
}

capture_evidence() {
  adb_device shell df -k /data > "$OUTPUT_DIR/final-storage.txt" 2>&1 || true
  adb_device shell dumpsys meminfo "$APP_PACKAGE" > "$OUTPUT_DIR/final-memory.txt" 2>&1 || true
  if adb_device shell run-as "$APP_PACKAGE" test -d files/checklist-results >/dev/null 2>&1; then
    adb_device exec-out run-as "$APP_PACKAGE" tar -cf - files/checklist-results > "$OUTPUT_DIR/checklist-results.tar" 2> "$OUTPUT_DIR/results-pull.log" || true
  fi
  local media_directory="/sdcard/Android/data/$APP_PACKAGE/files/checklist-evidence"
  # Shared-storage access uses adb's shell identity. run-as has a different
  # storage namespace and can be denied even for the target app's own directory.
  if adb_device shell test -d "$media_directory" >/dev/null 2>&1; then
    adb_device pull "$media_directory" "$OUTPUT_DIR/media-evidence" > "$OUTPUT_DIR/media-pull.log" 2>&1 || {
      printf 'External media evidence could not be pulled; see %s/media-pull.log\n' "$OUTPUT_DIR" >&2
      return 1
    }
  fi
}

stop_instrumentation() {
  local stop_status=0
  printf 'Stopping interrupted emulator instrumentation before storage cleanup.\n' >&2
  adb_device shell am force-stop "$TEST_PACKAGE" > "$OUTPUT_DIR/instrumentation-abort.txt" 2>&1 || stop_status=1
  adb_device shell am force-stop "$APP_PACKAGE" >> "$OUTPUT_DIR/instrumentation-abort.txt" 2>&1 || stop_status=1
  INSTRUMENTATION_RUNNING=0
  return "$stop_status"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$status" != 0 && "$INSTRUMENTATION_RUNNING" == 1 ]]; then
    stop_instrumentation || status=1
  fi
  remove_filler || status=1
  capture_evidence || status=1
  if [[ -n "$LOGCAT_PID" ]]; then kill "$LOGCAT_PID" 2>/dev/null; wait "$LOGCAT_PID" 2>/dev/null; fi
  printf '%s\n' "$status" > "$OUTPUT_DIR/exit-status.txt"
  printf 'Checklist exit status: %s. Evidence: %s\n' "$status" "$OUTPUT_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

find_java_home() {
  local candidate version major
  local candidates=("${JAVA_HOME:-}" '/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
    '/Applications/Android Studio.app/Contents/jbr' '/opt/android-studio/jbr' \
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home' \
    '/usr/lib/jvm/default-java' '/usr/lib/jvm/java-21-openjdk-amd64' '/usr/lib/jvm/java-17-openjdk-amd64')
  if [[ -x /usr/libexec/java_home ]]; then candidates+=("$(/usr/libexec/java_home 2>/dev/null || true)"); fi
  if command -v java >/dev/null 2>&1; then
    candidate=$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^[[:space:]]*java.home = //p' | head -n 1)
    candidates+=("$candidate")
  fi
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate/bin/java" ]] || continue
    version=$("$candidate/bin/java" -version 2>&1 | head -n 1)
    major=$(printf '%s\n' "$version" | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p')
    if [[ "$major" =~ ^[0-9]+$ && "$major" -ge 17 ]]; then printf '%s\n' "$candidate"; return; fi
  done
  die 'No local JDK 17+ found. Set JAVA_HOME to the JDK used by Android Studio.'
}

if [[ ${SKIP_BUILD:-0} != 1 ]]; then
  JDK_HOME=$(find_java_home)
  printf 'Building debug verification artifacts with %s\n' "$JDK_HOME"
  (
    cd "$ANDROID_PROJECT"
    JAVA_HOME="$JDK_HOME" OPENREEL_RELEASE_STORE_FILE='' OPENREEL_RELEASE_STORE_PASSWORD='' \
      OPENREEL_RELEASE_KEY_ALIAS='' OPENREEL_RELEASE_KEY_PASSWORD='' \
      ./gradlew "-Dorg.gradle.java.home=$JDK_HOME" :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain
  ) 2>&1 | tee "$OUTPUT_DIR/build.log"
fi
APP_APK="$ANDROID_PROJECT/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$ANDROID_PROJECT/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
[[ -s "$APP_APK" && -s "$TEST_APK" ]] || die 'Debug APKs are missing. Run without SKIP_BUILD=1.'
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$APP_APK" "$TEST_APK" > "$OUTPUT_DIR/apk-sha256.txt"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$APP_APK" "$TEST_APK" > "$OUTPUT_DIR/apk-sha256.txt"
else
  die 'A SHA-256 utility is required to record the APKs being tested.'
fi

set_offline() {
  # The modern command applies the radio change as well as the persisted setting.
  adb_device shell cmd connectivity airplane-mode enable > "$OUTPUT_DIR/offline-setup.txt" 2>&1 || {
    adb_device shell settings put global airplane_mode_on 1 >> "$OUTPUT_DIR/offline-setup.txt" 2>&1
    adb_device shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true >> "$OUTPUT_DIR/offline-setup.txt" 2>&1
  }
  adb_device shell svc wifi disable >> "$OUTPUT_DIR/offline-setup.txt" 2>&1
  adb_device shell svc data disable >> "$OUTPUT_DIR/offline-setup.txt" 2>&1
  verify_offline
}

verify_offline() {
  local attempt airplane wifi
  # API 33 and 37 ConnectivityService dumps expose this top-level field.
  # Fail closed if the schema changes rather than infer offline from radio intent.
  for attempt in {1..15}; do
    airplane=$(adb_device shell settings get global airplane_mode_on | tr -d '\r')
    wifi=$(adb_device shell settings get global wifi_on | tr -d '\r')
    adb_device shell dumpsys connectivity > "$OUTPUT_DIR/offline-connectivity.raw" 2>&1
    tr -d '\r' < "$OUTPUT_DIR/offline-connectivity.raw" > "$OUTPUT_DIR/offline-connectivity.txt"
    if [[ "$airplane" == 1 && "$wifi" == 0 ]] &&
      grep -Eq '^Active default network: none[[:space:]]*$' "$OUTPUT_DIR/offline-connectivity.txt"; then
      printf 'verified: airplane_mode_on=%s wifi_on=%s default_network=none attempt=%s\n' "$airplane" "$wifi" "$attempt" >> "$OUTPUT_DIR/offline-assertions.txt"
      return 0
    fi
    sleep 1
  done
  die "Emulator is not verified offline: airplane_mode_on=$airplane wifi_on=$wifi; inspect offline-connectivity.txt."
}

configure_deterministic_ui() {
  local phase=$1 setting value
  for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb_device shell settings put global "$setting" 0
  done
  {
    printf '\nPhase: %s\n' "$phase"
    adb_device shell wm size
    adb_device shell wm density
    for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
      value=$(adb_device shell settings get global "$setting" | tr -d '\r')
      printf '%s=%s\n' "$setting" "$value"
      [[ "$value" =~ ^0([.]0+)?$ ]] || die "Could not disable $setting."
    done
  } >> "$OUTPUT_DIR/display-and-animation-settings.txt"
  adb_device shell dumpsys display > "$OUTPUT_DIR/display-metrics-$phase.txt"
}

start_logcat() {
  if [[ -n "$LOGCAT_PID" ]]; then kill "$LOGCAT_PID" 2>/dev/null || true; wait "$LOGCAT_PID" 2>/dev/null || true; fi
  "${ADB_COMMAND[@]}" logcat -v threadtime -T 1 >> "$OUTPUT_DIR/logcat.txt" 2>&1 &
  LOGCAT_PID=$!
}

adb_device shell getprop > "$OUTPUT_DIR/device-properties.txt"
adb_device shell df -k /data > "$OUTPUT_DIR/initial-storage.txt"
set_offline
configure_deterministic_ui initial
adb_device install -r -t -g "$APP_APK" 2>&1 | tee "$OUTPUT_DIR/install-app.txt"
adb_device install -r -t -g "$TEST_APK" 2>&1 | tee "$OUTPUT_DIR/install-tests.txt"
start_logcat

run_check() {
  local label=$1 selection=$2
  shift 2
  local result="$OUTPUT_DIR/$label.txt" command_status=0
  printf '\nRunning %s\n' "$label"
  verify_offline
  INSTRUMENTATION_RUNNING=1
  # adb can exit 0 even when the instrumentation runner reports assertion errors.
  adb_device shell am instrument -w -r -e timeout_msec 600000 -e class "$selection" "$@" "$RUNNER" > "$result" 2>&1 || command_status=$?
  tr -d '\r' < "$result" > "$result.normalized"
  mv "$result.normalized" "$result"
  cat "$result"
  [[ "$command_status" == 0 ]] || die "$label: adb exited $command_status."
  if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|Process crashed|INSTRUMENTATION_RESULT: shortMsg=|INSTRUMENTATION_STATUS_CODE: -(1|2)([[:space:]]|$)' "$result"; then
    die "$label: instrumentation reported a failure."
  fi
  grep -Eq '^OK \([1-9][0-9]* tests?\)' "$result" || die "$label: no completed JUnit success result was reported."
  grep -Eq '^INSTRUMENTATION_CODE: -1[[:space:]]*$' "$result" || die "$label: instrumentation did not finish successfully."
  INSTRUMENTATION_RUNNING=0
  verify_offline
}

run_process_recovery() {
  # Separate instrumentation runs ensure a fresh process. A reboot additionally
  # clears in-memory registries and OS page cache before the recovery assertions.
  run_check cold-reopen-prepare com.pythonxi.openreelvideo.LocalProcessRecoveryChecklistTest -e recoveryPhase prepare
  adb_device shell run-as "$APP_PACKAGE" test -s files/checklist-process-marker.json || die 'Cold-reopen prepare did not create its durable marker.'
  adb_device shell am force-stop "$APP_PACKAGE"
  adb_device shell am force-stop "$TEST_PACKAGE"
  adb_device shell sync
  previous_boot_id=$(adb_device shell cat /proc/sys/kernel/random/boot_id | tr -d '\r')
  [[ -n "$previous_boot_id" ]] || die 'Could not identify the emulator boot before the recovery check.'
  adb_device reboot
  boot_deadline=$((SECONDS + 240))
  while true; do
    current_boot_id=$(adb_device shell cat /proc/sys/kernel/random/boot_id 2>/dev/null | tr -d '\r' || true)
    boot_completed=$(adb_device shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
    if [[ -n "$current_boot_id" && "$current_boot_id" != "$previous_boot_id" && "$boot_completed" == 1 ]]; then break; fi
    [[ $SECONDS -lt $boot_deadline ]] || die 'Emulator did not finish a new boot within four minutes.'
    sleep 2
  done
  printf 'before=%s\nafter=%s\n' "$previous_boot_id" "$current_boot_id" > "$OUTPUT_DIR/cold-reopen-boot-ids.txt"
  assert_emulator
  set_offline
  configure_deterministic_ui after-reboot
  start_logcat
  run_check cold-reopen-verify com.pythonxi.openreelvideo.LocalProcessRecoveryChecklistTest -e recoveryPhase verify

  adb_device shell run-as "$APP_PACKAGE" test ! -e files/checklist-process-marker.json || die 'Cold-reopen verify did not consume its durable marker.'
  adb_device shell run-as "$APP_PACKAGE" test -s files/checklist-results/process-recovery-verify.txt || die 'Cold-reopen verify did not write its result.'
}

for checklist in "${selected_classes[@]}"; do
  checklist=${checklist#com.pythonxi.openreelvideo.}
  if [[ "$checklist" == LocalProcessRecoveryChecklistTest ]]; then
    run_process_recovery
  else
    run_check "$checklist" "com.pythonxi.openreelvideo.$checklist"
  fi
done

available_data_bytes() {
  local kib
  kib=$(adb_device shell df -k /data | tr -d '\r' | awk 'NR > 1 && NF >= 6 { print $(NF-2); exit }')
  [[ "$kib" =~ ^[0-9]+$ ]] || die 'Could not measure emulator /data capacity.'
  printf '%s\n' "$((kib * 1024))"
}

if [[ ${RUN_LOW_STORAGE:-0} == 1 ]]; then
  assert_emulator
  target_free=$((32 * 1024 * 1024))
  free_before=$(available_data_bytes)
  [[ "$free_before" -gt "$target_free" ]] || die 'Already below the requested 32 MiB free-space target; remove existing emulator filler first.'
  candidate_directory="/data/local/tmp/openreel-checklist-$$-$(date +%s)"
  adb_device shell mkdir "$candidate_directory"
  # Set ownership tracking only after exclusive creation succeeds. Cleanup never
  # removes unrelated files, directories or a pre-existing filler path.
  FILLER_DIRECTORY=$candidate_directory
  FILLER_FILE="$FILLER_DIRECTORY/storage.fill"
  filler_bytes=$((free_before - target_free))
  filler_mode="fallocate"
  if ! adb_device shell fallocate -l "$filler_bytes" "$FILLER_FILE" > "$OUTPUT_DIR/storage-fill.txt" 2>&1; then
    filler_mode="dd"
    adb_device shell rm -f "$FILLER_FILE"
    free_before=$(available_data_bytes)
    filler_chunks=$(((free_before - target_free) / 1024 / 1024))
    [[ "$filler_chunks" -gt 0 ]] || die 'No safe space available for the low-storage fixture.'
    adb_device shell dd if=/dev/zero "of=$FILLER_FILE" bs=1048576 "count=$filler_chunks" >> "$OUTPUT_DIR/storage-fill.txt" 2>&1
  fi
  adb_device shell sync
  # Android may reclaim old cache as the low-space threshold is crossed.
  # Extend our own allocation a bounded number of times to restore the target.
  for adjustment in 1 2 3; do
    remaining=$(available_data_bytes)
    printf 'Capacity adjustment %s: %s free bytes\n' "$adjustment" "$remaining" >> "$OUTPUT_DIR/storage-fill.txt"
    [[ "$remaining" -gt $((target_free + 2 * 1024 * 1024)) ]] || break
    if [[ "$filler_mode" == fallocate ]]; then
      filler_bytes=$((filler_bytes + remaining - target_free))
      adb_device shell fallocate -l "$filler_bytes" "$FILLER_FILE" >> "$OUTPUT_DIR/storage-fill.txt" 2>&1
    else
      extra_chunks=$(((remaining - target_free) / 1024 / 1024))
      adb_device shell dd if=/dev/zero "of=$FILLER_FILE" bs=1048576 "seek=$filler_chunks" "count=$extra_chunks" conv=notrunc >> "$OUTPUT_DIR/storage-fill.txt" 2>&1
      filler_chunks=$((filler_chunks + extra_chunks))
    fi
    adb_device shell sync
  done
  remaining=$(available_data_bytes)
  printf 'Physical /data free bytes before test: %s\n' "$remaining" | tee -a "$OUTPUT_DIR/storage-fill.txt"
  [[ "$remaining" -ge $((24 * 1024 * 1024)) && "$remaining" -le $((36 * 1024 * 1024)) ]] || die 'Physical storage did not reach the safe 24–36 MiB test window.'
  run_check low-storage-import 'com.pythonxi.openreelvideo.LocalRecoveryChecklistTest#lowStorageImportPreservesSavedProject' -e lowStorageExpected true
  remove_filler
else
  printf '\nLow-storage check skipped; opt in with RUN_LOW_STORAGE=1.\n'
fi
printf '\nAll requested emulator checks passed.\n'
