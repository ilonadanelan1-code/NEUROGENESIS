cmake_minimum_required(VERSION 3.16)
project(neurogenesis_core LANGUAGES CXX)

add_library(neurogenesis_core STATIC neuro_core.cpp)
target_include_directories(neurogenesis_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(neurogenesis_core PUBLIC cxx_std_17)
set_target_properties(neurogenesis_core PROPERTIES
    CXX_EXTENSIONS OFF
    POSITION_INDEPENDENT_CODE ON
)