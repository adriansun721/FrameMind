# FrameMind native core dependencies

Eigen 3.4.0, Copyright Eigen contributors, MPL-2.0 (and permissive notices retained in source). Built with EIGEN_MPL2_ONLY. Unmodified corresponding source archive eigen.zip and COPYING.MPL2 accompany the executable. Source: https://gitlab.com/libeigen/eigen/-/tree/3.4.0

JSON for Modern C++ 3.11.3, Copyright (c) 2013-2023 Niels Lohmann, MIT. The unmodified single header json.hpp accompanies the executable and contains the copyright and complete MIT permission notice. Source: https://github.com/nlohmann/json/releases/tag/v3.11.3

Only these header dependencies are linked into the native executable. MSVC C/C++ runtime is statically linked (/MT); no compiler or separately installed VC runtime is required to run the core.
