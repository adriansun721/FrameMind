#include <Eigen/Dense>
#include <json.hpp>
#include <chrono>
#include <cmath>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <vector>

using Json = nlohmann::json;
using Matrix = Eigen::MatrixXd;
using Vector = Eigen::VectorXd;
using Vec3 = Eigen::Vector3d;
static const Json dofOrder = {"ux", "uy", "uz", "rx", "ry", "rz"};
static const Json solver = {{"implementation", "framemind-native/1"}, {"algorithm", "partial-pivot-gaussian"},
    {"constraints", "free-dof-elimination"}, {"relativePivotTolerance", 1e-12}};

struct Failure : std::runtime_error {
    Json diagnostic;
    Failure(std::string code, std::string message, Json target = nullptr, std::string field = "input")
        : std::runtime_error(message), diagnostic({{"code", code}, {"message", message}, {"field", field}}) {
        if (!target.is_null()) diagnostic["target"] = target;
    }
};

static void require(bool condition, const std::string& message, Json target = nullptr, std::string field = "input") {
    if (!condition) throw Failure("native-input-error", message, target, field);
}
static double number(const Json& value) {
    require(value.is_number(), "Expected a finite numeric value");
    double result = value.get<double>();
    require(std::isfinite(result), "Expected a finite numeric value");
    return result;
}
static std::string id(const Json& value) {
    require(value.is_string() && !value.get<std::string>().empty(), "Missing object identity");
    return value.get<std::string>();
}
static double parameter(const Json& resource, const std::string& kind, const std::string& field, bool positive) {
    const Json target={{"kind",kind},{"id",resource.at("id")}};
    require(resource.contains(field) && resource.at(field).is_number(), "Missing or invalid " + field, target, field);
    const double value=resource.at(field).get<double>();
    require(std::isfinite(value) && (!positive || value>0), "Invalid " + field, target, field);
    return value;
}
static Vec3 vector3(const Json& value, Json target, const std::string& prefix) {
    Vec3 result;
    const char* axes[]={"x","y","z"};
    for (int i=0;i<3;++i) {
        const std::string field=prefix+"."+axes[i];
        require(value.contains(axes[i]) && value.at(axes[i]).is_number(), "Missing or invalid " + field, target, field);
        result[i]=value.at(axes[i]).get<double>();
        require(std::isfinite(result[i]), "Invalid " + field, target, field);
    }
    return result;
}
static Json json3(const Vec3& v) { return {{"x", v[0]}, {"y", v[1]}, {"z", v[2]}}; }
static Json jsonVector(const Vector& v) {
    Json result = Json::array();
    for (Eigen::Index i = 0; i < v.size(); ++i) result.push_back(v[i]);
    return result;
}
static Json jsonMatrix(const Matrix& m) {
    Json result = Json::array();
    for (Eigen::Index i = 0; i < m.rows(); ++i) result.push_back(jsonVector(m.row(i).transpose()));
    return result;
}
static std::string now() {
    auto time = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &time);
#else
    gmtime_r(&time, &utc);
#endif
    std::ostringstream out;
    out << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return out.str();
}
static void emit(const Json& message) { std::cout << message.dump() << '\n' << std::flush; }

static Matrix stiffness(double l, double e, double nu, double area, double iy, double iz, double j) {
    Matrix k = Matrix::Zero(12, 12);
    const double axial = e * area / l, torsion = e * j / (2 * (1 + nu) * l);
    for (auto pair : {std::pair<int, double>(0, axial), {3, torsion}}) {
        const int i = pair.first;
        k(i,i) = k(i+6,i+6) = pair.second;
        k(i,i+6) = k(i+6,i) = -pair.second;
    }
    // Hermite bending blocks, with ry = -dw/dx and rz = dv/dx.
    for (int plane = 0; plane < 2; ++plane) {
        const double ei = e * (plane == 0 ? iz : iy);
        const double a = 12 * ei / std::pow(l,3), b = 6 * ei / (l*l), c = 4 * ei / l, d = 2 * ei / l;
        Matrix block(4,4);
        block << a,b,-a,b, b,c,-b,d, -a,-b,a,-b, b,d,-b,c;
        const int indices[2][4] = {{1,5,7,11}, {2,4,8,10}};
        const double signs[2][4] = {{1,1,1,1}, {1,-1,1,-1}};
        for (int r=0;r<4;++r) for (int col=0;col<4;++col)
            k(indices[plane][r],indices[plane][col]) = block(r,col)*signs[plane][r]*signs[plane][col];
    }
    return k;
}

static Vector solve(Matrix a, Vector b, const std::vector<int>& free, const Json& nodes) {
    const int size = static_cast<int>(b.size());
    const double scale = a.cwiseAbs().maxCoeff(), threshold = scale * 1e-12;
    for (int pivot=0;pivot<size;++pivot) {
        int selected = pivot;
        for (int row=pivot+1;row<size;++row) if (std::abs(a(row,pivot)) > std::abs(a(selected,pivot))) selected=row;
        const double magnitude = std::abs(a(selected,pivot));
        if (!std::isfinite(magnitude)) throw Failure("native-computation-error", "Nonfinite elimination pivot");
        if (magnitude <= threshold) {
            const int global = free[pivot];
            Failure failure("singular-system", "Reduced stiffness pivot does not exceed the registered threshold",
                {{"kind","node"},{"id",nodes[global/6]["id"]}}, "restraints");
            failure.diagnostic["dof"] = dofOrder[global%6];
            failure.diagnostic["evidence"] = {{"pivotMagnitude",magnitude},{"threshold",threshold},{"matrixScale",scale},{"globalDofIndex",global}};
            throw failure;
        }
        a.row(pivot).swap(a.row(selected)); std::swap(b[pivot],b[selected]);
        for (int row=pivot+1;row<size;++row) {
            const double factor = a(row,pivot)/a(pivot,pivot);
            for (int col=pivot;col<size;++col) a(row,col) -= factor*a(pivot,col);
            b[row] -= factor*b[pivot];
        }
    }
    Vector result = Vector::Zero(size);
    for (int row=size-1;row>=0;--row) {
        double value=b[row];
        for (int col=row+1;col<size;++col) value-=a(row,col)*result[col];
        result[row]=value/a(row,row);
    }
    if (!result.allFinite()) throw Failure("native-computation-error", "Nonfinite displacement");
    return result;
}

static Json calculate(const Json& request, Json& stages, std::string& stage) {
    auto phase = [&](const std::string& name) {
        stage=name;
        Json record={{"stage",name},{"startedAt",now()}};
        stages.push_back(record);
        emit({{"kind","phase"},{"requestId",request.at("requestId")},{"record",record}});
    };
    id(request.at("requestId")); id(request.at("analysisId"));
    phase("model-check");
    const auto& input=request.at("input");
    require(request.at("version")=="framemind-analysis/1", "Unsupported protocol version");
    id(input.at("projectId"));
    const double revision=number(input.at("projectRevision"));
    require(revision>=0 && revision<=9007199254740991.0 && std::floor(revision)==revision, "Invalid project revision");
    require(input.at("dofOrder")==dofOrder && input.at("solver")==solver, "Unsupported DOF or solver contract");
    require(input.at("assumptions")==Json({{"theory","3d-euler-bernoulli-frame"},{"shearDeformation","neglected"},
        {"rigidJoints",true},{"units","m-kN-kN·m"},{"localAxis","member-geometry"}}), "Unsupported units or theory");
    const auto& nodes=input.at("nodes"); const auto& members=input.at("members");
    require(nodes.is_array() && nodes.size()==2 && members.is_array() && members.size()==1, "T2-13 supports exactly two nodes and one member");
    const auto& member=members[0]; id(member.at("id"));
    const Json memberTarget={{"kind","member"},{"id",member.at("id")}};
    const std::string n0=id(nodes[0].at("id")), n1=id(nodes[1].at("id"));
    require(n0!=n1, "Duplicate node identity");
    const int start=member.at("startNodeId")==n0 ? 0 : 1, end=1-start;
    require(member.at("startNodeId")==nodes[start]["id"], "Invalid member start node", memberTarget, "startNodeId");
    require(member.at("endNodeId")==nodes[end]["id"], "Invalid member end node", memberTarget, "endNodeId");
    const Vec3 delta=vector3(nodes[end].at("position"),{{"kind","node"},{"id",nodes[end]["id"]}},"position")
        -vector3(nodes[start].at("position"),{{"kind","node"},{"id",nodes[start]["id"]}},"position");
    const double length=delta.norm();
    require(std::isfinite(length) && length>1e-12, "Invalid member length", memberTarget, "endNodeId");
    auto resource = [&](const std::string& key, const std::string& reference) -> Json {
        require(input.at(key).is_array(), "Invalid resource array");
        Json found; int matches=0;
        for (const auto& value:input.at(key)) if (value.at("id")==member.at(reference)) { found=value; ++matches; }
        require(matches==1, "Missing or duplicate referenced resource", memberTarget, reference); return found;
    };
    const auto material=resource("materials","materialId"), section=resource("sections","sectionId");
    const double e=parameter(material,"material","elasticModulusGPa",true)*1e6, nu=parameter(material,"material","poissonRatio",false);
    const double area=parameter(section,"section","areaM2",true), iy=parameter(section,"section","secondMomentYM4",true), iz=parameter(section,"section","secondMomentZM4",true), j=parameter(section,"section","torsionalConstantM4",true);
    require(nu>-1 && nu<0.5, "Poisson ratio must be between -1 and 0.5", {{"kind","material"},{"id",material.at("id")}}, "poissonRatio");
    parameter(material,"material","densityKgM3",true);
    const double angle=parameter(member,"member","rotationDegrees",false)*std::acos(-1.0)/180;
    const Vec3 x=delta/length, reference=std::abs(x.z())<0.9 ? Vec3(0,0,1) : Vec3(0,1,0);
    const Vec3 baseY=reference.cross(x).normalized(), baseZ=x.cross(baseY);
    const Vec3 y=baseY*std::cos(angle)+baseZ*std::sin(angle), z=-baseY*std::sin(angle)+baseZ*std::cos(angle);
    std::vector<int> indices;
    for (int node:{start,end}) for (int d=0;d<6;++d) indices.push_back(node*6+d);
    bool restrained[12]={};
    require(input.at("supports").is_array(), "Invalid supports");
    for (const auto& support:input.at("supports")) {
        id(support.at("id"));
        const Json target={{"kind","support"},{"id",support.at("id")}};
        require(support.at("nodeId")==n0 || support.at("nodeId")==n1, "Invalid support node",target,"nodeId");
        const int node=support.at("nodeId")==n0 ? 0 : 1;
        const auto& restraints=support.at("restraints");
        require(restraints.is_array() && restraints.size()==6, "Invalid support DOFs",target,"restraints");
        for (int d=0;d<6;++d) { require(restraints[d].is_boolean(), "Invalid restraint",target,"restraints"); restrained[node*6+d]=restrained[node*6+d] || restraints[d].get<bool>(); }
    }
    Vector force=Vector::Zero(12);
    auto addLoads = [&](const Json& loads, const Json& uniform, const Json& weight, const Json& caseId, double factor) {
        require(loads.is_array() && uniform.is_array() && uniform.empty() && weight.at("enabled")==false, "T2-13 supports nodal end loads only; distributed loads and self-weight require T2-14");
        for (const auto& load:loads) {
            id(load.at("id"));
            const Json target={{"kind","load"},{"id",load.at("id")}};
            require(load.at("loadCaseId")==caseId, "Invalid load case reference",target,"loadCaseId");
            require(load.at("nodeId")==n0 || load.at("nodeId")==n1, "Invalid load node reference",target,"nodeId");
            const int node=load.at("nodeId")==n0 ? 0 : 1;
            force.segment<3>(node*6)+=factor*vector3(load.at("force"),target,"force");
            force.segment<3>(node*6+3)+=factor*vector3(load.at("moment"),target,"moment");
        }
    };
    Json dependencies=Json::array(); Json source;
    if (input.contains("combination")) {
        const auto& combination=input.at("combination");
        source=combination.at("definition").at("id"); id(source);
        const auto& terms=combination.at("definition").at("terms"); const auto& cases=combination.at("cases");
        require(terms.is_array() && !terms.empty() && terms.size()==cases.size(), "Invalid combination cases");
        for (size_t i=0;i<terms.size();++i) {
            const auto& term=terms[i]; const auto& c=cases[i]; const double factor=number(term.at("factor"));
            require(term.at("loadCaseId")==c.at("loadCase").at("id"), "Combination case order mismatch");
            dependencies.push_back(term);
            addLoads(c.at("nodalLoads"),c.at("uniformLoads"),c.at("selfWeight"),term.at("loadCaseId"),factor);
        }
        // The frozen service contract already carries the effective weighted loads.
        Vector effective=force; force.setZero();
        addLoads(input.at("nodalLoads"),input.value("uniformLoads",Json::array()),input.at("selfWeight"),input.at("loadCase").at("id"),1);
        require((force-effective).cwiseAbs().maxCoeff()<=1e-9, "Combination effective loads mismatch");
    } else {
        source=input.at("loadCase").at("id"); id(source);
        dependencies.push_back({{"loadCaseId",source},{"factor",1}});
        addLoads(input.at("nodalLoads"),input.value("uniformLoads",Json::array()),input.at("selfWeight"),source,1);
    }
    require(request.at("sourceId")==source && request.at("dependencies")==dependencies, "Source dependency mismatch");
    const auto& origin=request.at("origin");
    require(origin.at("kind")=="formal-model", "T2-13 trial requires formal-model origin");
    phase("assembly");
    Matrix local=stiffness(length,e,nu,area,iy,iz,j), transform=Matrix::Zero(12,12);
    for (int block=0;block<4;++block) { transform.block<1,3>(block*3,block*3)=x.transpose(); transform.block<1,3>(block*3+1,block*3)=y.transpose(); transform.block<1,3>(block*3+2,block*3)=z.transpose(); }
    const Matrix memberGlobal=transform.transpose()*local*transform;
    Matrix global=Matrix::Zero(12,12);
    for (int i=0;i<12;++i) for (int col=0;col<12;++col) global(indices[i],indices[col])=memberGlobal(i,col);
    if (!global.allFinite() || !force.allFinite()) throw Failure("native-computation-error", "Nonfinite assembled stiffness or loads");
    std::vector<int> free, constrained;
    for (int i=0;i<12;++i) (restrained[i] ? constrained : free).push_back(i);
    require(!free.empty(), "No free DOFs for the single-member trial");
    const int size=static_cast<int>(free.size());
    Matrix reduced(size,size); Vector rhs(size);
    for (int i=0;i<size;++i) { rhs[i]=force[free[i]]; for (int col=0;col<size;++col) reduced(i,col)=global(free[i],free[col]); }
    phase("solve");
    const Vector solved=solve(reduced,rhs,free,nodes);
    Vector displacement=Vector::Zero(12);
    for (int i=0;i<size;++i) displacement[free[i]]=solved[i];
    phase("recovery");
    Vector reaction=global*displacement-force, elementDisplacement(12);
    for (int i=0;i<12;++i) elementDisplacement[i]=displacement[indices[i]];
    Vector endForces=local*transform*elementDisplacement;
    if (!reaction.allFinite() || !endForces.allFinite()) throw Failure("native-computation-error", "Nonfinite recovered result");
    const Vector localDisplacement=transform*elementDisplacement;
    Json responses=Json::array();
    for (int i=0;i<=16;++i) {
        const double t=i/16.0, position=length*t;
        const double h0=1-3*t*t+2*t*t*t, h1=length*(t-2*t*t+t*t*t), h2=3*t*t-2*t*t*t, h3=length*(-t*t+t*t*t);
        const Vec3 localSample(localDisplacement[0]*(1-t)+localDisplacement[6]*t,
            h0*localDisplacement[1]+h1*localDisplacement[5]+h2*localDisplacement[7]+h3*localDisplacement[11],
            h0*localDisplacement[2]-h1*localDisplacement[4]+h2*localDisplacement[8]-h3*localDisplacement[10]);
        const Vec3 globalSample=x*localSample.x()+y*localSample.y()+z*localSample.z();
        Vector actions=-endForces.head(6);
        actions[4]-=endForces[2]*position; actions[5]+=endForces[1]*position;
        if (!actions.allFinite() || !localSample.allFinite() || !globalSample.allFinite()) throw Failure("native-computation-error", "Nonfinite station recovery");
        responses.push_back({{"position",position},{"forces",jsonVector(actions)},{"localDisplacement",json3(localSample)},{"globalDisplacement",json3(globalSample)}});
    }
    Json nodeResults=Json::array(), dofs=Json::array();
    for (int node=0;node<2;++node) {
        for (int d=0;d<6;++d) dofs.push_back({{"nodeId",nodes[node]["id"]},{"dof",dofOrder[d]},{"globalIndex",node*6+d},{"restrained",restrained[node*6+d]}});
        nodeResults.push_back({{"nodeId",nodes[node]["id"]},{"displacement",json3(displacement.segment<3>(node*6))},{"rotation",json3(displacement.segment<3>(node*6+3))},
            {"reaction",json3(reaction.segment<3>(node*6))},{"reactionMoment",json3(reaction.segment<3>(node*6+3))}});
    }
    Json elementDofs=Json::array(); for (int i:indices) elementDofs.push_back(dofs[i]);
    Json process={{"solver",solver},{"dofOrder",dofOrder},{"dofs",dofs},{"loadVector",jsonVector(force)},
        {"constrainedDofs",constrained},{"freeDofs",free},{"assembledStiffness",jsonMatrix(global)},{"reducedStiffness",jsonMatrix(reduced)},{"matrixLimit",72},
        {"members",Json::array({{{"memberId",member["id"]},{"dofs",elementDofs},{"globalDofIndices",indices},{"globalStiffness",jsonMatrix(memberGlobal)},{"equivalentGlobalForces",jsonVector(Vector::Zero(12))}}})}};
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},
        {"projectRevision",input["projectRevision"]},{"origin",origin},{"sourceId",source},{"dependencies",dependencies},{"solver",solver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},
        {"nodes",nodeResults},{"members",Json::array({{{"memberId",member["id"]},{"length",length},{"localAxes",{{"x",json3(x)},{"y",json3(y)},{"z",json3(z)}}},
        {"localEndForces",{{"start",jsonVector(endForces.head(6))},{"end",jsonVector(endForces.tail(6))}}},{"nativeResponses",responses}}})},{"process",process},{"service",service}};
}

int main() {
    Json request, stages=Json::array(); std::string stage="model-check";
    try {
        std::string bytes; char c;
        while (std::cin.get(c)) { if (bytes.size()>=4*1024*1024) throw Failure("native-input-error", "Input exceeds 4 MiB"); bytes.push_back(c); }
        request=Json::parse(bytes);
        Json result=calculate(request,stages,stage);
        emit({{"kind","result"},{"requestId",request.at("requestId")},{"result",result}});
        return 0;
    } catch (const Failure& error) {
        emit({{"kind","error"},{"requestId",request.is_object() ? request.value("requestId",Json(nullptr)) : Json(nullptr)},
            {"error",{{"name","AnalysisFailure"},{"message",error.what()},{"stage",stage},{"diagnostics",Json::array({error.diagnostic})}}}});
    } catch (const std::exception& error) {
        emit({{"kind","error"},{"requestId",request.is_object() ? request.value("requestId",Json(nullptr)) : Json(nullptr)},
            {"error",{{"name","AnalysisFailure"},{"message",error.what()},{"stage",stage},
            {"diagnostics",Json::array({{{"code",stage=="model-check" ? "native-input-error" : "native-computation-error"},{"message",error.what()},{"field","input"}}})}}}});
    }
    return 1;
}
