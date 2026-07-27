cmake_minimum_required(VERSION 3.13)

include(pico_sdk_import.cmake)

project(openshrooly_coprocessor C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(PICO_NO_PICOTOOL 1 CACHE BOOL "Build without optional picotool post-processing")

pico_sdk_init()

add_subdirectory(src)
