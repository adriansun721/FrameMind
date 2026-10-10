// Sparse coordinate helpers shared by modal, buckling, and second-order
// target-scale adapters.  A dense 12 x n transformation for every element
// multiplies memory by the number of members; these rows keep only the
// non-zero free-coordinate map for one element at a time.
struct FreeElementRows {
    std::array<std::vector<std::pair<int, double>>, 12> rows;
};

static FreeElementRows freeElementRows(const StaticElement& element, const std::vector<int>& reduced, int& nextExtra) {
    FreeElementRows result;
    for (int local = 0; local < 12; ++local) {
        if (std::find(element.released.begin(), element.released.end(), local) != element.released.end()) {
            result.rows[local].push_back({nextExtra++, 1.0});
            continue;
        }
        for (int global = 0; global < 12; ++global) {
            const int coordinate = reduced[element.indices[global]];
            const double coefficient = element.transform(local, global);
            if (coordinate >= 0 && coefficient != 0) result.rows[local].push_back({coordinate, coefficient});
        }
    }
    return result;
}

static void addMappedMatrix(const Matrix& local, const FreeElementRows& rows, std::vector<Triplet>& entries) {
    for (int r = 0; r < 12; ++r) for (int c = 0; c < 12; ++c) {
        const double value = local(r, c);
        if (value == 0) continue;
        for (const auto& [row, rowCoefficient] : rows.rows[r]) for (const auto& [column, columnCoefficient] : rows.rows[c]) {
            const double contribution = value * rowCoefficient * columnCoefficient;
            if (contribution != 0) entries.emplace_back(row, column, contribution);
        }
    }
}

static double mappedDot(const std::array<std::vector<std::pair<int, double>>, 12>& rows, const Vector& values, int local) {
    double result = 0;
    for (const auto& [coordinate, coefficient] : rows[local]) result += coefficient * values[coordinate];
    return result;
}

static Vector mappedLocalVector(const FreeElementRows& rows, const Vector& values) {
    Vector result(12);
    for (int local = 0; local < 12; ++local) result[local] = mappedDot(rows.rows, values, local);
    return result;
}

static Sparse sparseFromTriplets(int size, std::vector<Triplet>& entries) {
    Sparse result(size, size);
    result.setFromTriplets(entries.begin(), entries.end());
    result.makeCompressed();
    entries.clear();
    entries.shrink_to_fit();
    return result;
}

struct SparseEigenpairs { Vector values; Matrix vectors; };

// Rayleigh-Ritz in a block Krylov space for B x = mu A x, A positive definite.
// The Cholesky congruence makes the operator symmetric; unlike ordinary power
// iteration this retains repeated roots and selects algebraically largest
// (positive) roots even when the reference geometric stiffness is indefinite.
static SparseEigenpairs largestSparseEigenpairs(const Sparse& a, const Sparse& b, int requested, const std::string& method, bool positive=true, bool allowApproximate=false) {
    const int size=static_cast<int>(a.rows());
    Eigen::SimplicialLLT<Sparse> factor(a);
    if (factor.info()!=Eigen::Success) throw Failure(method+"-unstable-matrix","Positive-definite sparse factorization failed",nullptr,method);
    const Sparse lower=factor.matrixL();
    for (int i=0;i<size;++i) if (!std::isfinite(lower.coeff(i,i)) || lower.coeff(i,i)*lower.coeff(i,i)<=1e-12)
        throw Failure(method+"-unstable-matrix","Scaled Cholesky pivot is below the registered tolerance",nullptr,method);
    auto fromBasis=[&](const Vector& v) -> Vector { return factor.permutationPinv()*factor.matrixU().solve(v); };
    auto apply=[&](const Vector& v) -> Vector {
        const Vector rhs=factor.permutationP()*(b*fromBasis(v));
        return factor.matrixL().solve(rhs);
    };
    const int block=std::min(size,std::max(8,requested+4));
    // Keep the target-scale Krylov workset below the 512 MiB native cap. The
    // requested roots still get a 16x expansion; threshold-only callers may
    // return a conservative Ritz bound when this workspace is exhausted.
    const int maximum=std::min(size,std::max(160,requested*16));
    Matrix basis=Matrix::Zero(size,maximum), products=Matrix::Zero(size,maximum);
    int used=0, processed=0; unsigned int seed=0x24517;
    SparseEigenpairs best{Vector::Zero(requested), Matrix::Zero(size,requested)};
    bool haveBest=false;
    auto append=[&](Vector v) {
        const double original=v.norm();
        for (int pass=0;pass<2;++pass) if (used) v.noalias()-=basis.leftCols(used)*(basis.leftCols(used).transpose()*v).eval();
        const double length=v.norm();
        if (!std::isfinite(length) || length<=std::max(1e-30,original*1e-12)) return false;
        basis.col(used++)=v/length; return true;
    };
    auto randomVector=[&]() { Vector v(size); for (int i=0;i<size;++i) { seed=1664525*seed+1013904223; v[i]=double(seed)/4294967296.0-.5; } return v; };
    while (used<block) append(randomVector());
    const double eigTolerance=method=="buckling" ? 1e-8 : 1e-9;
    while (processed<maximum) {
        products.col(processed)=apply(basis.col(processed));
        if (!products.col(processed).allFinite()) throw Failure(method+"-eigensolver-failed","Nonfinite sparse spectral operator",nullptr,method);
        ++processed;
        if (processed>=block && (processed%block==0 || processed==maximum)) {
            Matrix projected=basis.leftCols(processed).transpose()*products.leftCols(processed);
            projected=(projected+projected.transpose()).eval()/2;
            Eigen::SelfAdjointEigenSolver<Matrix> eig(projected);
            if (eig.info()!=Eigen::Success) throw Failure(method+"-eigensolver-failed","Projected eigensolver failed",nullptr,method);
            SparseEigenpairs result{Vector(requested),Matrix(size,requested)};
            bool converged=true;
            for (int i=0;i<requested;++i) {
                const auto coefficients=eig.eigenvectors().col(processed-1-i);
                const double value=eig.eigenvalues()[processed-1-i];
                const Vector v=basis.leftCols(processed)*coefficients;
                const Vector bv=products.leftCols(processed)*coefficients;
                const double residual=(bv-value*v).norm();
                if (positive && !(value>0) || residual>eigTolerance*std::max(1e-30,std::abs(value))) converged=false;
                result.values[i]=allowApproximate && i==0 ? (value>=0 ? value+residual : value-residual) : value;
                result.vectors.col(i)=fromBasis(v);
            }
            if (result.values.allFinite() && result.vectors.allFinite()) { best=result; haveBest=true; }
            if (converged) return result;
        }
        if (used<maximum && !append(products.col(processed-1)) && used==processed) {
            // A closed invariant subspace can omit another copy of a repeated
            // root; start an independent block rather than returning it early.
            while (used<std::min(maximum,processed+block)) append(randomVector());
        }
    }
    if (allowApproximate && haveBest) {
        // A Ritz value plus its symmetric-operator residual is a conservative
        // spectral-radius bound. This path is used only for zero/cutoff
        // thresholds; actual reported eigenpairs always require convergence.
        return best;
    }
    throw Failure(method+"-eigensolver-failed","Sparse eigenpairs did not converge within the Krylov workspace budget",nullptr,method);
}

