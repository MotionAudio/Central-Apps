cmake_minimum_required(VERSION 3.22)

# Motion Studio - Motion Audio's own DAW.
# Built on JUCE + Tracktion Engine (both GPLv3 for this personal build).

if (APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "Minimum macOS version")
    if (NOT CMAKE_OSX_ARCHITECTURES)
        set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "Universal binary")
    endif()
endif()

project(MotionStudio VERSION 1.0.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if (APPLE)
    enable_language(OBJC OBJCXX)
endif()

# Tracktion Engine (with JUCE inside it). Either next to this folder, or given with -DTE_DIR=...
if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/deps/tracktion_engine/modules/juce/CMakeLists.txt")
    set(TE_DIR_DEFAULT "${CMAKE_CURRENT_SOURCE_DIR}/deps/tracktion_engine")
else()
    set(TE_DIR_DEFAULT "${CMAKE_CURRENT_SOURCE_DIR}/../te")
endif()
set(TE_DIR "${TE_DIR_DEFAULT}" CACHE PATH "Path to tracktion_engine")
if (NOT EXISTS "${TE_DIR}/modules/juce/CMakeLists.txt")
    message(FATAL_ERROR "Tracktion Engine with JUCE not found at ${TE_DIR}. Run scripts/get-deps.sh first.")
endif()
add_subdirectory("${TE_DIR}/modules/juce" juce_build)
add_subdirectory("${TE_DIR}/modules" tracktion_build)

juce_add_gui_app(MotionStudio
    PRODUCT_NAME "Motion Studio"
    COMPANY_NAME "Motion Audio"
    COMPANY_WEBSITE "https://motionaudio.org"
    BUNDLE_ID "org.motionaudio.motionstudio"
    VERSION ${PROJECT_VERSION}
    ICON_BIG "${CMAKE_CURRENT_SOURCE_DIR}/Resources/icon.png"
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "Motion Studio records from your audio interface."
    DOCUMENT_EXTENSIONS motionstudio
    NEEDS_CURL TRUE
    NEEDS_WEB_BROWSER FALSE
    PLUGINHOST_AU TRUE
    HARDENED_RUNTIME_ENABLED FALSE)

juce_generate_juce_header(MotionStudio)

file(GLOB MS_CMFX "${CMAKE_CURRENT_SOURCE_DIR}/Resources/cmfx/*.cmfx.json")
file(GLOB MS_FONTS "${CMAKE_CURRENT_SOURCE_DIR}/Resources/fonts/*.ttf")
juce_add_binary_data(MotionStudioData
    NAMESPACE MotionData
    SOURCES
        ${MS_CMFX}
        ${MS_FONTS}
        "${CMAKE_CURRENT_SOURCE_DIR}/Resources/boards.json"
        "${CMAKE_CURRENT_SOURCE_DIR}/Resources/icon.png")

file(GLOB_RECURSE MS_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/Source/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source/*.h")

target_sources(MotionStudio PRIVATE
    ${MS_SOURCES}
    ThirdParty/MotionAudio/mapedals/mapedals.c
    ThirdParty/MotionAudio/cmfx/cmfx.c
    ThirdParty/MotionAudio/cmfx/cmfx_code.c
    ThirdParty/MotionAudio/cmfx/cmfx_util.c)

target_include_directories(MotionStudio PRIVATE
    Source
    ThirdParty/MotionAudio/mapedals
    ThirdParty/MotionAudio/cmfx
    ThirdParty/tsf)

target_compile_definitions(MotionStudio PRIVATE
    JUCE_PLUGINHOST_AU=1
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_LADSPA=1
    JUCE_PLUGINHOST_LV2=0
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_STRICT_REFCOUNTEDPOINTER=1
    JUCE_USE_CURL=1
    JUCE_LOAD_CURL_SYMBOLS_LAZILY=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_MP3AUDIOFORMAT=1
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:MotionStudio,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:MotionStudio,JUCE_VERSION>"
    TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH=1
    TRACKTION_AIR_WINDOWS=1)

target_link_libraries(MotionStudio PRIVATE
    MotionStudioData
    tracktion::tracktion_core
    tracktion::tracktion_engine
    tracktion::tracktion_graph
    juce::juce_audio_devices
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_recommended_config_flags)

set_source_files_properties(
    ThirdParty/MotionAudio/mapedals/mapedals.c
    ThirdParty/MotionAudio/cmfx/cmfx.c
    ThirdParty/MotionAudio/cmfx/cmfx_code.c
    ThirdParty/MotionAudio/cmfx/cmfx_util.c
    PROPERTIES COMPILE_OPTIONS "-w")

if (APPLE)
    target_compile_options(MotionStudio PRIVATE "-fno-aligned-allocation")
    target_link_libraries(MotionStudio PRIVATE "-framework Accelerate")
endif()

if (CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_libraries(MotionStudio PRIVATE "-latomic")
endif()

if (CMAKE_CXX_COMPILER_ID MATCHES "GNU")
    target_compile_options(MotionStudio PRIVATE -Wno-unknown-pragmas)
endif()
