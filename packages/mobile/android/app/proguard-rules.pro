# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# expo-modules（R8 开启后依赖反射注册的模块类必须保留，否则运行时崩溃）
-keep class expo.modules.** { *; }

# Hermes / JNI（RN 运行时反射）
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Add any project specific keep options here:
