// JNI bridge for app.beside.llm.NativeEngine.
#include <jni.h>

#include <string>

#include "engine.h"

using beside::Engine;

namespace {
Engine * self(jlong h) { return reinterpret_cast<Engine *>(h); }

std::string str(JNIEnv * env, jstring s) {
    if (!s) return "";
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string out(c);
    env->ReleaseStringUTFChars(s, c);
    return out;
}

// Text crosses the boundary as UTF-8 bytes: JNI's own string conversion uses "modified
// UTF-8", which breaks emoji and other characters outside the basic plane.
std::string bytes(JNIEnv * env, jbyteArray a) {
    if (!a) return "";
    const jsize n = env->GetArrayLength(a);
    std::string out(n, '\0');
    env->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte *>(out.data()));
    return out;
}

jbyteArray jbytes(JNIEnv * env, const std::string & s) {
    jbyteArray a = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(a, 0, (jsize) s.size(), reinterpret_cast<const jbyte *>(s.data()));
    return a;
}

// Messages from the engine are plain ASCII, so the standard conversion is safe for them.
jstring jstr(JNIEnv * env, const std::string & s) { return env->NewStringUTF(s.c_str()); }
}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_app_beside_llm_NativeEngine_nativeCreate(JNIEnv *, jobject) {
    return reinterpret_cast<jlong>(new Engine());
}

JNIEXPORT void JNICALL Java_app_beside_llm_NativeEngine_nativeDestroy(JNIEnv *, jobject, jlong h) { delete self(h); }

JNIEXPORT jstring JNICALL Java_app_beside_llm_NativeEngine_nativeLoad(JNIEnv * env, jobject, jlong h, jstring path,
                                                                      jint n_ctx, jint n_threads) {
    return jstr(env, self(h)->load(str(env, path), n_ctx, n_threads));
}

JNIEXPORT void JNICALL Java_app_beside_llm_NativeEngine_nativeUnload(JNIEnv *, jobject, jlong h) { self(h)->unload(); }

JNIEXPORT jstring JNICALL Java_app_beside_llm_NativeEngine_nativeDescribe(JNIEnv * env, jobject, jlong h) {
    return jstr(env, self(h)->describe());
}

JNIEXPORT jstring JNICALL Java_app_beside_llm_NativeEngine_nativeSetSystem(JNIEnv * env, jobject, jlong h,
                                                                           jbyteArray text) {
    return jstr(env, self(h)->set_system(bytes(env, text)));
}

JNIEXPORT jstring JNICALL Java_app_beside_llm_NativeEngine_nativeReset(JNIEnv * env, jobject, jlong h) {
    return jstr(env, self(h)->reset_to_system());
}

JNIEXPORT jstring JNICALL Java_app_beside_llm_NativeEngine_nativeAppend(JNIEnv * env, jobject, jlong h, jstring role,
                                                                        jbyteArray content) {
    return jstr(env, self(h)->append({str(env, role), bytes(env, content)}));
}

JNIEXPORT void JNICALL Java_app_beside_llm_NativeEngine_nativeStop(JNIEnv *, jobject, jlong h) {
    self(h)->request_stop();
}

JNIEXPORT jint JNICALL Java_app_beside_llm_NativeEngine_nativeNPast(JNIEnv *, jobject, jlong h) {
    return self(h)->n_past();
}

JNIEXPORT jint JNICALL Java_app_beside_llm_NativeEngine_nativeNCtx(JNIEnv *, jobject, jlong h) {
    return self(h)->n_ctx();
}

// Streams UTF-8 pieces to callback.onPiece(ByteArray): Boolean. Returns
// [status, promptTokens, tokens, firstTokenMs, tokensPerSecond].
JNIEXPORT jdoubleArray JNICALL Java_app_beside_llm_NativeEngine_nativeGenerate(JNIEnv * env, jobject, jlong h,
                                                                               jbyteArray user, jint max_tokens,
                                                                               jobject callback) {
    jclass cls = env->GetObjectClass(callback);
    jmethodID on_piece = env->GetMethodID(cls, "onPiece", "([B)Z");
    auto r = self(h)->generate(bytes(env, user), max_tokens, 0.7f, [&](const std::string & piece) {
        jbyteArray s = jbytes(env, piece);
        const bool more = env->CallBooleanMethod(callback, on_piece, s);
        env->DeleteLocalRef(s);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            return false;
        }
        return more;
    });
    const jdouble values[] = {(double) r.status, (double) r.prompt_tokens, (double) r.tokens, r.first_token_ms,
                              r.tokens_per_second};
    jdoubleArray out = env->NewDoubleArray(5);
    env->SetDoubleArrayRegion(out, 0, 5, values);
    return out;
}

}  // extern "C"
