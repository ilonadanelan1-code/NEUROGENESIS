cmake_minimum_required(VERSION 3.16)
project(neurogenesis_core LANGUAGES CXX)

add_library(neurogenesis_core STATIC neuro_core.cpp)
target_include_directories(neurogenesis_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(neurogenesis_core PUBLIC cxx_std_17)
set_target_properties(neurogenesis_core PROPERTIES
    CXX_EXTENSIONS OFF
    POSITION_INDEPENDENT_CODE ON
)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(neurogenesis_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

include(CTest)
if(BUILD_TESTING)
    add_executable(neurogenesis_core_test neuro_core.test.cpp)
    target_link_libraries(neurogenesis_core_test PRIVATE neurogenesis_core)
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(neurogenesis_core_test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    endif()
    add_test(NAME neurogenesis_core_test COMMAND neurogenesis_core_test)
endif()
