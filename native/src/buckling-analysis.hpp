// Dead loads on the undeformed elastic frame. Initial stress enters only through
// axial-force transverse Hermite slope energy; no follower or torsional stress terms.
static Matrix initialStressGeometric(const StaticElement& e, double start, double end) {
    Matrix result=Matrix::Zero(12,12);
    const double points[3]={.5-std::sqrt(15.0)/10,.5,.5+std::sqrt(15.0)/10};
    const double weights[3]={5.0/18,8.0/18,5.0/18};
    const int indices[2][4]={{1,5,7,11},{2,4,8,10}};
    const double signs[2][4]={{1,1,1,1},{1,-1,1,-1}};
    for (int point=0;point<3;++point) {
        const double t=points[point], n=start*(1-t)+end*t, l=e.length;
        const double slope[4]={(-6*t+6*t*t)/l,1-4*t+3*t*t,(6*t-6*t*t)/l,-2*t+3*t*t};
        for (int plane=0;plane<2;++plane) for (int r=0;r<4;++r) for (int c=0;c<4;++c)
            result(indices[plane][r],indices[plane][c])+=n*l*weights[point]*slope[r]*slope[c]*signs[plane][r]*signs[plane][c];
    }
    return result;
}

static Json bucklingStaticPacket(const Json& request, const Json& level, const Json& pattern) {
    Json input=request.at("input"); input.erase("analysisCase"); input.erase("bucklingLoads");
    if (!pattern.is_null()) for (auto it=pattern.begin();it!=pattern.end();++it) input[it.key()]=it.value();
    Json packet=request; packet["input"]=meshInput(input,level);
    const auto& calculation=packet["input"];
    packet["sourceId"]=calculation.contains("combination") ? calculation.at("combination").at("definition").at("id") : calculation.at("loadCase").at("id");
    packet["dependencies"]=calculation.contains("combination") ? calculation.at("combination").at("definition").at("terms") : Json::array({{{"loadCaseId",calculation.at("loadCase").at("id")},{"factor",1}}});
    return packet;
}

static Json bucklingShape(const Json& input, const Json& level, const ModalAssembly& assembly, const std::vector<Matrix>& maps, const Vector& q) {
    Vector u=Vector::Zero(assembly.size); for (size_t i=0;i<assembly.free.size();++i) u[assembly.free[i]]=q[i];
    Json nodes=Json::array(), members=Json::array();
    for (size_t i=0;i<input.at("nodes").size();++i) nodes.push_back({{"nodeId",input["nodes"][i]["id"]},{"translation",json3(u.segment<3>(i*6))},{"rotation",json3(u.segment<3>(i*6+3))}});
    size_t offset=0; const int divisions=level.at("divisions").get<int>();
    for (const auto& m:input.at("members")) {
        const double length=number(input["meshPlan"]["frames"][id(m["id"])]["length"]); Json samples=Json::array();
        for (int station=0;station<=16;++station) {
            const int scaled=station*divisions, segment=std::min(divisions-1,scaled/16); const double t=(scaled-segment*16)/16.0;
            const auto index=offset+segment; const auto& e=assembly.elements[index]; const Vector v=maps[index]*q;
            const double h0=1-3*t*t+2*t*t*t, h1=e.length*(t-2*t*t+t*t*t), h2=3*t*t-2*t*t*t, h3=e.length*(-t*t+t*t*t);
            const Vec3 local((1-t)*v[0]+t*v[6],h0*v[1]+h1*v[5]+h2*v[7]+h3*v[11],h0*v[2]-h1*v[4]+h2*v[8]-h3*v[10]);
            samples.push_back({{"position",length*station/16},{"translation",json3(e.x*local.x()+e.y*local.y()+e.z*local.z())}});
        }
        members.push_back({{"memberId",m["id"]},{"samples",samples}}); offset+=divisions;
    }
    return {{"nodes",nodes},{"members",members}};
}

static void remapMeshFailure(Failure& failure, const Json& level) {
    if (!failure.diagnostic.contains("target")) return;
    auto& target=failure.diagnostic["target"]; const auto key=target.value("id",std::string());
    for (const auto& n:level["nodes"]) if (n["nodeId"]==key) { target={{"kind","member"},{"id",n["memberId"]}}; failure.diagnostic["position"]=n["position"]; }
    for (const auto& e:level["elements"]) if (e["elementId"]==key) { target={{"kind","member"},{"id",e["memberId"]}}; failure.diagnostic["position"]=e["start"]; }
}

struct BucklingLevelResult { Json modes, prestress, eigenproblem, preloadRuns; int equations, releases; };
static BucklingLevelResult solveBucklingLevel(const Json& request, const Json& level, int modeCount, int maxEquations, std::string& stage, const std::function<void(const std::string&)>& onPhase) {
    const auto& input=request.at("input"); Json ignored=Json::array();
    const Json zeroPacket=bucklingStaticPacket(request,level,nullptr);
    ModalAssembly assembly; assembly.onPhase=onPhase;
    calculateStatic(zeroPacket,ignored,stage,false,true,&assembly);
    const int nodal=static_cast<int>(assembly.free.size()); int releases=0;
    for (const auto& e:assembly.elements) releases+=static_cast<int>(e.released.size());
    const int count=nodal+releases;
    if (!count || count>maxEquations) throw Failure("buckling-budget-exhausted","No calculation coordinates within buckling equation budget",nullptr,"buckling");
    const auto& patterns=input.at("bucklingLoads");
    Json fixedStages=Json::array(), referenceStages=Json::array();
    const Json fixed=calculateStatic(bucklingStaticPacket(request,level,patterns.at("fixed")),fixedStages,stage,false,true);
    const Json reference=calculateStatic(bucklingStaticPacket(request,level,patterns.at("reference")),referenceStages,stage,false,true);
    Matrix k=Matrix::Zero(count,count), gf=k, gr=k; std::vector<Matrix> maps;
    std::vector<int> reducedIndex(assembly.size,-1); for (int i=0;i<nodal;++i) reducedIndex[assembly.free[i]]=i;
    int extra=nodal; Json prestress=Json::array();
    for (size_t i=0;i<assembly.elements.size();++i) {
        const auto& e=assembly.elements[i]; Matrix b=Matrix::Zero(12,count);
        for (int local=0;local<12;++local) for (int global=0;global<12;++global) { const int r=reducedIndex[e.indices[global]]; if (r>=0) b(local,r)=e.transform(local,global); }
        for (int local:e.released) { b.row(local).setZero(); b(local,extra++)=1; }
        const auto& f=fixed.at("members")[i].at("localEndForces"); const auto& r=reference.at("members")[i].at("localEndForces");
        const double fs=-number(f.at("start")[0]), fe=number(f.at("end")[0]), rs=-number(r.at("start")[0]), re=number(r.at("end")[0]);
        k.noalias()+=b.transpose()*e.original*b;
        gf.noalias()+=b.transpose()*initialStressGeometric(e,fs,fe)*b;
        gr.noalias()+=b.transpose()*initialStressGeometric(e,rs,re)*b;
        const auto& mapping=level.at("elements")[i]; Json record=mapping; record.erase("startNodeId"); record.erase("endNodeId");
        record["fixedAxialStartKN"]=fs; record["fixedAxialEndKN"]=fe; record["referenceAxialStartKN"]=rs; record["referenceAxialEndKN"]=re; prestress.push_back(record);
        maps.push_back(std::move(b));
    }
    k=(k+k.transpose()).eval()/2; gf=(gf+gf.transpose()).eval()/2; gr=(gr+gr.transpose()).eval()/2;
    if (!k.allFinite() || !gf.allFinite() || !gr.allFinite()) throw Failure("buckling-nonfinite-matrices","Nonfinite elastic or geometric stiffness",nullptr,"buckling");
    Vector scale(count); for (int i=0;i<count;++i) { if (!(k(i,i)>0)) throw Failure("singular-system","Missing elastic stiffness",nullptr,"restraints"); scale[i]=1/std::sqrt(k(i,i)); }
    const Matrix a=scale.asDiagonal()*(k+gf)*scale.asDiagonal(), g=scale.asDiagonal()*gr*scale.asDiagonal();
    Eigen::LLT<Matrix> factor(a);
    if (!a.allFinite() || !g.allFinite() || factor.info()!=Eigen::Success || factor.matrixL().toDenseMatrix().diagonal().array().square().minCoeff()<=1e-12)
        throw Failure("buckling-unstable-preload","Fixed preload tangent is not positive definite; reduce fixed loads and check supports/releases",nullptr,"fixed");
    stage="solve"; if (onPhase) onPhase(stage);
    const Matrix inverse=factor.matrixL().solve(Matrix::Identity(count,count));
    const Matrix reciprocal=-inverse*g*inverse.transpose();
    Eigen::SelfAdjointEigenSolver<Matrix> eig((reciprocal+reciprocal.transpose()).eval()/2);
    if (!reciprocal.allFinite() || eig.info()!=Eigen::Success || !eig.eigenvalues().allFinite() || !eig.eigenvectors().allFinite()) throw Failure("buckling-eigensolver-failed","Reciprocal symmetric eigensolver failed",nullptr,"buckling");
    const double threshold=eig.eigenvalues().cwiseAbs().maxCoeff()*1e-12;
    Json modes=Json::array(), vectors=Json::array();
    for (int i=count-1;i>=0 && static_cast<int>(modes.size())<modeCount;--i) {
        const double mu=eig.eigenvalues()[i]; if (!(mu>threshold)) continue;
        const double lambda=1/mu; Vector q=scale.asDiagonal()*factor.matrixU().solve(eig.eigenvectors().col(i)); q.normalize();
        const double denominator=(k.norm()+gf.norm()+lambda*gr.norm())*q.norm();
        const double residual=((k+gf)*q+lambda*gr*q).norm()/std::max(1e-30,denominator);
        if (!q.allFinite() || !std::isfinite(lambda) || !std::isfinite(denominator) || !std::isfinite(residual) || residual>1e-8) throw Failure("buckling-residual-failed","Nonfinite eigenpair or residual above 1e-8",nullptr,"buckling");
        Json mode=bucklingShape(input,level,assembly,maps,q); mode["number"]=modes.size()+1; mode["factor"]=lambda; mode["residual"]=residual; modes.push_back(mode); vectors.push_back(jsonVector(q));
    }
    if (modes.empty()) throw Failure("buckling-no-positive-factor","No finite positive buckling factor for the reference load direction; check reference axial forces",nullptr,"reference");
    Json coordinates=Json::array();
    for (int index:assembly.free) coordinates.push_back({{"kind","node"},{"id",zeroPacket["input"]["nodes"][index/6]["id"]},{"dof",dofOrder[index%6]}});
    for (const auto& e:assembly.elements) for (int index:e.released) coordinates.push_back({{"kind","release"},{"id",e.member["id"]},{"dof",std::string(index<6 ? "start." : "end.")+(index%6==4 ? "my" : "mz")}});
    Json problem={{"matrixLimit",144},{"coordinates",coordinates},{"releaseNullRotations",assembly.releaseNullRotations},{"vectors",vectors},{"stiffness",count<=144 ? jsonMatrix(k) : Json(nullptr)},
        {"fixedGeometric",count<=144 ? jsonMatrix(gf) : Json(nullptr)},{"referenceGeometric",count<=144 ? jsonMatrix(gr) : Json(nullptr)}};
    return {modes,prestress,problem,{{"fixed",fixed},{"reference",reference}},count,releases};
}

static Json calculateBuckling(const Json& request, Json& stages, std::string& stage) {
    auto phase=[&](const std::string& name) { stage=name; Json record={{"stage",name},{"startedAt",now()}}; stages.push_back(record); emit({{"kind","phase"},{"requestId",request.at("requestId")},{"record",record}}); };
    phase("model-check"); const auto& input=request.at("input"), definition=input.at("analysisCase"), settings=definition.at("settings").at("buckling");
    const Json bucklingSolver={{"implementation","framemind-native/6"},{"algorithm","generalized-self-adjoint"},{"constraints","free-dof-elimination"},{"relativePivotTolerance",1e-12}};
    require(input.at("solver")==bucklingSolver && definition.at("method")=="buckling" && definition.at("loadSourceId")=="buckling" && definition.at("settings").size()==2 && definition.at("settings").at("solver")=="native-buckling", "Unsupported buckling contract");
    Json identityInput=input; identityInput["analysisCase"]["method"]="static"; identityInput["analysisCase"]["loadSourceId"]=input.at("loadCase").at("id"); identityInput["analysisCase"]["settings"]={{"solver","native-static"}}; analysisCaseSource(identityInput,input.at("loadCase").at("id"));
    require(settings.is_object() && settings.size()==6,"Invalid buckling settings");
    const double modes=number(settings.at("modeCount")), budget=number(settings.at("maxEquations")), div=number(settings.at("maxDivisions")), tolerance=number(settings.at("factorTolerance"));
    require(modes>=1 && modes<=20 && std::floor(modes)==modes && budget>=1 && budget<=1200 && std::floor(budget)==budget && (div==1 || div==2 || div==4 || div==8 || div==16) && tolerance>0 && tolerance<=.01,"Invalid buckling extraction parameters");
    const auto& patterns=input.at("bucklingLoads"); Json dependencies=Json::array();
    require(input.at("nodalLoads").empty() && input.at("uniformLoads").empty() && input.at("selfWeight").at("enabled")==false && !input.contains("combination"),"Buckling loads must be separate fixed and reference patterns");
    for (const auto& role:{"fixed","reference"}) {
        const auto& terms=settings.at(role), pattern=patterns.at(role); require(terms.is_array(),"Buckling terms must be arrays");
        if (terms.empty()) { require(std::string(role)=="fixed" && pattern.is_null(),"Only fixed preload may be zero"); continue; }
        require(pattern.is_object() && pattern.at("combination").at("definition").at("terms")==terms,"Frozen buckling pattern mismatch");
        bool nonzero=false; for (const auto& t:terms) { const double f=number(t.at("factor")); nonzero=nonzero || f!=0; Json record=t; record["role"]=role; dependencies.push_back(record); }
        require(std::string(role)=="fixed" || nonzero,"Reference factors cannot all be zero");
    }
    require(request.at("sourceId")==definition.at("id") && request.at("dependencies")==dependencies,"Buckling source/dependency mismatch");
    const auto& plan=input.at("meshPlan"); const Json policy={{"maxDivisions",div},{"maxEquations",budget},{"relativeTolerance",1e-6},{"displacementTolerance",1e-12},{"forceTolerance",1e-8}};
    require(meshNumbersMatch(plan.at("policy"),policy) && meshNumbersMatch(plan.at("frames"),meshFrames(input)),"Buckling mesh policy/frames mismatch");
    int levels=0; for (int d=1;d<=static_cast<int>(div);d*=2) { require(levels<static_cast<int>(plan.at("levels").size()) && meshNumbersMatch(plan["levels"][levels],meshLevel(input,d)),"Buckling mesh mapping mismatch"); ++levels; }
    require(levels==static_cast<int>(plan.at("levels").size()),"Unexpected buckling mesh levels");
    Json runs=Json::array(), selected; BucklingLevelResult finalResult; std::string status="budget-exhausted", reason="max-divisions";
    for (const auto& level:plan.at("levels")) {
        std::set<std::pair<std::string,int>> constrained; for (const auto& support:input.at("supports")) for (int d=0;d<6;++d) if (support.at("restraints")[d]==true) constrained.insert({id(support["nodeId"]),d});
        int releases=0; for (const auto& m:input.at("members")) if (m.contains("endReleases")) for (const auto& end:{"start","end"}) for (const auto& component:{"my","mz"}) if (m["endReleases"][end][component]==true) ++releases;
        const size_t estimate=(input.at("nodes").size()+level.at("nodes").size())*6-constrained.size()+releases;
        if (!estimate) continue;
        if (estimate>static_cast<size_t>(budget)) { reason="equation-budget"; break; }
        try { finalResult=solveBucklingLevel(request,level,static_cast<int>(modes),static_cast<int>(budget),stage,runs.empty() ? std::function<void(const std::string&)>(phase) : std::function<void(const std::string&)>()); }
        catch (Failure& failure) { remapMeshFailure(failure,level); throw; }
        selected=level; Json factors=Json::array(); for (const auto& m:finalResult.modes) factors.push_back(m["factor"]);
        Json run={{"divisions",level["divisions"]},{"equations",finalResult.equations},{"factors",factors}};
        if (!runs.empty() && factors.size()==static_cast<size_t>(modes) && runs.back()["factors"].size()==factors.size()) {
            double error=0; for (size_t i=0;i<factors.size();++i) { const double a=number(factors[i]), b=number(runs.back()["factors"][i]); error=std::max(error,std::abs(a-b)/std::max(a,b)); }
            run["error"]=error; if (error<=tolerance) { status="converged"; reason="factor-tolerance"; }
        }
        runs.push_back(run); if (status=="converged") break;
    }
    if (runs.empty()) throw Failure("buckling-budget-exhausted","Equation budget prevents initial buckling mesh",nullptr,"buckling");
    if (status!="converged") throw Failure("buckling-not-converged","Buckling factors did not converge within the mesh/equation budget; increase the budget or reduce the requested modes",nullptr,reason);
    phase("recovery"); Json record={{"equation","(K+Gfixed+lambda*Greference)phi=0"},{"geometricStiffness","axial-force-hermite-dead-load"},{"normalization","unit-euclidean-calculation-vector"},
        {"modes",finalResult.modes},{"preloadRuns",finalResult.preloadRuns},{"prestress",finalResult.prestress},{"eigenproblem",finalResult.eigenproblem},{"selectedDivisions",selected["divisions"]},
        {"convergence",{{"status",status},{"reason",reason},{"runs",runs}}},
        {"counts",{{"engineeringNodes",input.at("nodes").size()},{"engineeringMembers",input.at("members").size()},{"calculationNodes",input.at("nodes").size()+selected.at("nodes").size()},
        {"calculationElements",selected.at("elements").size()},{"equations",finalResult.equations},{"releaseCoordinates",finalResult.releases}}}};
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},
        {"origin",request["origin"]},{"sourceId",request["sourceId"]},{"dependencies",dependencies},{"solver",bucklingSolver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},{"nodes",Json::array()},{"members",Json::array()},{"buckling",record},{"service",service}};
}
