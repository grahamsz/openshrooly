# Standard Raspberry Pi Pico SDK import helper.

if (DEFINED ENV{PICO_SDK_PATH} AND NOT PICO_SDK_PATH)
    set(PICO_SDK_PATH $ENV{PICO_SDK_PATH})
endif()

if (DEFINED ENV{PICO_SDK_FETCH_FROM_GIT} AND NOT PICO_SDK_FETCH_FROM_GIT)
    set(PICO_SDK_FETCH_FROM_GIT $ENV{PICO_SDK_FETCH_FROM_GIT})
endif()

set(PICO_SDK_PATH "${PICO_SDK_PATH}" CACHE PATH "Path to the Raspberry Pi Pico SDK")
set(PICO_SDK_FETCH_FROM_GIT "${PICO_SDK_FETCH_FROM_GIT}" CACHE BOOL "Fetch the Pico SDK")

if (NOT PICO_SDK_PATH)
    if (PICO_SDK_FETCH_FROM_GIT)
        include(FetchContent)
        FetchContent_Declare(
            pico_sdk
            GIT_REPOSITORY https://github.com/raspberrypi/pico-sdk
            # Pico SDK 2.2.0
            GIT_TAG a1438dff1d38bd9c65dbd693f0e5db4b9ae91779
            GIT_SUBMODULES_RECURSE FALSE
        )
        FetchContent_Populate(pico_sdk)
        set(PICO_SDK_PATH ${pico_sdk_SOURCE_DIR})
    else()
        message(FATAL_ERROR "Set PICO_SDK_PATH or PICO_SDK_FETCH_FROM_GIT=ON")
    endif()
endif()

get_filename_component(PICO_SDK_PATH "${PICO_SDK_PATH}" REALPATH BASE_DIR "${CMAKE_BINARY_DIR}")
set(PICO_SDK_INIT_CMAKE_FILE "${PICO_SDK_PATH}/pico_sdk_init.cmake")

if (NOT EXISTS "${PICO_SDK_INIT_CMAKE_FILE}")
    message(FATAL_ERROR "${PICO_SDK_PATH} is not a Pico SDK checkout")
endif()

include("${PICO_SDK_INIT_CMAKE_FILE}")
