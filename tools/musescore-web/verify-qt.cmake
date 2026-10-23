cmake_minimum_required(VERSION 3.16)

# Qt's ConfigVersion.cmake is a wrapper. Its generated Impl file provides the
# PACKAGE_VERSION value; the wrapper itself need not contain a version number.
set(version_file "$ENV{QT_ROOT_DIR}/lib/cmake/Qt6Core/Qt6CoreConfigVersionImpl.cmake")
if(NOT EXISTS "${version_file}")
    message(FATAL_ERROR "Missing Qt version metadata: ${version_file}")
endif()
include("${version_file}")
if(NOT PACKAGE_VERSION VERSION_EQUAL "6.10.2")
    message(FATAL_ERROR "Expected Qt 6.10.2, found '${PACKAGE_VERSION}'")
endif()
message(STATUS "Verified Qt ${PACKAGE_VERSION}")
