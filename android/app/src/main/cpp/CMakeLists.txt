# libbeside.so: llama.cpp (static) plus the chat engine and its JNI bridge.
cmake_minimum_required(VERSION 3.22)
project(beside C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP ON CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI OFF CACHE BOOL "" FORCE)
if(ANDROID_ABI STREQUAL "arm64-v8a")
    # Exynos 1380 (Cortex-A78/A55): ARMv8.2 with dot-product and half-precision.
    set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16" CACHE STRING "" FORCE)
endif()

if(LLAMA_SRC AND EXISTS "${LLAMA_SRC}/CMakeLists.txt")
    add_subdirectory(${LLAMA_SRC} llama)
else()
    include(FetchContent)
    FetchContent_Declare(llama
        GIT_REPOSITORY https://github.com/ggml-org/llama.cpp
        GIT_TAG b11700 # commit 23f7aabc16c72f6f707dba227251c35d7bd1ed96
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(llama)
endif()

add_library(beside SHARED engine.cpp chat_format.cpp jni.cpp)
target_link_libraries(beside PRIVATE llama-common llama android log)
target_link_options(beside PRIVATE "-Wl,-z,max-page-size=16384")
