#!/bin/bash
T=/tmp/rnprobe; rm -rf $T; mkdir -p $T; cd $T
GC=/c/Users/Admin/.gradle/caches/modules-2/files-2.1
F=$(find $GC/com.facebook.react/react-android -name "*.aar" | head -1)
echo "react-android aar: $F"
mkdir -p rn && (cd rn && unzip -o -q "$F" classes.jar && unzip -o -q classes.jar)
echo "=== HeadlessJsTaskContext ==="
javap -p -classpath rn com.facebook.react.jstasks.HeadlessJsTaskContext | head -30
echo "=== HeadlessJsTaskConfig ==="
javap -p -classpath rn com.facebook.react.jstasks.HeadlessJsTaskConfig | head -20
echo "=== HeadlessJsTaskEventListener ==="
javap -p -classpath rn com.facebook.react.jstasks.HeadlessJsTaskEventListener
echo "=== Arguments.createMap ==="
javap -p -classpath rn com.facebook.react.bridge.Arguments | grep -iE "createMap|createArray"
echo "=== LinearCountingRetryPolicy ==="
javap -p -classpath rn com.facebook.react.jstasks.LinearCountingRetryPolicy 2>/dev/null | head -10
