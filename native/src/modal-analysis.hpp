// Euler-Bernoulli consistent translational mass; torsion has polar inertia.
// Bending rotary inertia and shear deformation are deliberately neglected.
static Matrix modalMass(const StaticElement& e, double polarArea) {
    // Added line mass is located on the reference axis, with no rotary inertia.
    const double line=e.member.contains("additionalLineMassKgM") ? number(e.member.at("additionalLineMassKgM")) : 0;
    Matrix mass=Matrix::Zero(12,12); const double l=e.length, total=(e.density*e.area+line)*l/1000;
    for (const auto& entry:std::vector<std::pair<int,double>>{{0,total},{3,e.density*polarArea*l/1000}}) {
        const int i=entry.first; const double m=entry.second/6;
        mass(i,i)=mass(i+6,i+6)=2*m; mass(i,i+6)=mass(i+6,i)=m;
    }
    Matrix block(4,4);
    block<<156,22*l,54,-13*l,22*l,4*l*l,13*l,-3*l*l,54,13*l,156,-22*l,-13*l,-3*l*l,-22*l,4*l*l;
    const int indices[2][4]={{1,5,7,11},{2,4,8,10}}; const double signs[2][4]={{1,1,1,1},{1,-1,1,-1}};
    for (int plane=0;plane<2;++plane) for (int r=0;r<4;++r) for (int c=0;c<4;++c)
        mass(indices[plane][r],indices[plane][c])=total/420*block(r,c)*signs[plane][r]*signs[plane][c];
    return mass;
}

struct ModalLevelResult { Json modes; int equations, releaseCoordinates, zeroEnergyModes; double orthogonalityError, zeroEigenvalueTolerance; Json eigenproblem; };

static ModalLevelResult solveModalLevel(const Json& request, const Json& level, int modeCount, int maxEquations, std::string& stage, const std::function<void(const std::string&)>& onPhase) {
    const auto& input=request.at("input"); Json calculation=meshInput(input,level);
    calculation.erase("analysisCase");
    Json packet=request; packet["input"]=calculation; packet["sourceId"]=calculation.at("loadCase").at("id");
    packet["dependencies"]=Json::array({{{"loadCaseId",packet["sourceId"]},{"factor",1}}});
    ModalAssembly assembly; assembly.onPhase=onPhase; Json innerStages=Json::array();
    try { calculateStatic(packet,innerStages,stage,false,true,&assembly); }
    catch (Failure& failure) {
        if (failure.diagnostic.contains("target")) {
            auto& target=failure.diagnostic["target"]; const auto key=target.value("id",std::string());
            for (const auto& n:level["nodes"]) if (n["nodeId"]==key) { target={{"kind","member"},{"id",n["memberId"]}}; failure.diagnostic["position"]=n["position"]; }
            for (const auto& e:level["elements"]) if (e["elementId"]==key) { target={{"kind","member"},{"id",e["memberId"]}}; failure.diagnostic["position"]=e["start"]; }
        }
        throw;
    }
    // Modal recovery only needs the original element stiffness, frame
    // transform, and release metadata. Drop dense matrices retained by the
    // static publication path before allocating the eigen workspace.
    Json calculationNodeIds=Json::array(); for (const auto& node:calculation["nodes"]) calculationNodeIds.push_back(node["id"]);
    for (auto& element:assembly.elements) {
        element.local.resize(0,0); element.global.resize(0,0); element.recovery.resize(0,0); element.releaseInverse.resize(0,0);
    }
    packet.clear(); calculation.clear();
    int releases=0; for (const auto& e:assembly.elements) releases+=static_cast<int>(e.released.size());
    const int nodal=static_cast<int>(assembly.free.size()), count=nodal+releases;
    if (!count) throw Failure("modal-no-free-dofs","No unconstrained inertial coordinates remain",nullptr,"restraints");
    if (count>maxEquations) throw Failure("modal-budget-exhausted","Modal equation budget exhausted",nullptr,"modal");
    std::vector<Triplet> stiffnessEntries, massEntries;
    stiffnessEntries.reserve(assembly.elements.size() * 144);
    massEntries.reserve(assembly.elements.size() * 144);
    std::vector<FreeElementRows> maps; maps.reserve(assembly.elements.size());
    std::map<std::string,Json> sections; for (const auto& s:input.at("sections")) sections[id(s["id"])]=s;
    std::vector<int> reducedIndex(assembly.size,-1); for (int i=0;i<nodal;++i) reducedIndex[assembly.free[i]]=i;
    int extra=nodal;
    for (size_t i=0;i<input.at("nodes").size();++i) {
        const auto& node=input["nodes"][i];
        const double point=node.contains("additionalMassKg") ? number(node.at("additionalMassKg"))/1000 : 0;
        for (int axis=0;axis<3;++axis) { const int r=reducedIndex[i*6+axis]; if (r>=0) massEntries.emplace_back(r,r,point); }
    }
    for (const auto& e:assembly.elements) {
        const FreeElementRows b=freeElementRows(e,reducedIndex,extra);
        const auto& section=sections.at(id(e.member["sectionId"]));
        const Matrix localMass=modalMass(e,number(section["secondMomentYM4"])+number(section["secondMomentZM4"]));
        addMappedMatrix(e.original,b,stiffnessEntries); addMappedMatrix(localMass,b,massEntries); maps.push_back(b);
    }
    require(extra==count,"Modal release-coordinate mapping is inconsistent");
    Sparse k=sparseFromTriplets(count,stiffnessEntries), mass=sparseFromTriplets(count,massEntries);
    for (int i=0;i<k.outerSize();++i) for (Sparse::InnerIterator it(k,i);it;++it) if (!std::isfinite(it.value())) throw Failure("modal-nonfinite-matrices","Nonfinite stiffness or mass",nullptr,"modal");
    for (int i=0;i<mass.outerSize();++i) for (Sparse::InnerIterator it(mass,i);it;++it) if (!std::isfinite(it.value())) throw Failure("modal-nonfinite-matrices","Nonfinite stiffness or mass",nullptr,"modal");
    for (int i=0;i<count;++i) if (!(mass.coeff(i,i)>0)) throw Failure("modal-singular-mass","Missing positive inertia at a free coordinate",nullptr,"densityKgM3");
    stage="solve"; if (onPhase) onPhase(stage);
    const int extracted=std::min(modeCount,count);
    std::vector<Vector> eigenvectors; std::vector<double> eigenvalues;
    double zeroThreshold=0; int zeroCount=0;
    if (count<=1200) {
        Vector scale(count); for (int i=0;i<count;++i) scale[i]=1/std::sqrt(mass.coeff(i,i));
        const Matrix scaledK=scale.asDiagonal()*Matrix(k)*scale.asDiagonal(), scaledM=scale.asDiagonal()*Matrix(mass)*scale.asDiagonal();
        Eigen::LLT<Matrix> factor(scaledM);
        if (factor.info()!=Eigen::Success || factor.matrixL().toDenseMatrix().diagonal().array().square().minCoeff()<=1e-12) throw Failure("modal-singular-mass","Mass matrix is not positive definite above the registered scaled pivot tolerance",nullptr,"densityKgM3");
        Eigen::GeneralizedSelfAdjointEigenSolver<Matrix> eig(scaledK,scaledM);
        if (eig.info()!=Eigen::Success || !eig.eigenvalues().allFinite() || !eig.eigenvectors().allFinite()) throw Failure("modal-eigensolver-failed","Generalized self-adjoint eigensolver did not converge",nullptr,"modal");
        zeroThreshold=std::max(1.0,eig.eigenvalues().cwiseAbs().maxCoeff())*1e-12;
        for (int i=0;i<count;++i) {
            if (eig.eigenvalues()[i]<-zeroThreshold) throw Failure("modal-negative-stiffness","Negative eigenvalue exceeds the zero-energy tolerance",nullptr,"restraints");
            if (std::abs(eig.eigenvalues()[i])<=zeroThreshold) ++zeroCount;
        }
        for (int i=0;i<extracted;++i) { eigenvectors.push_back(scale.asDiagonal()*eig.eigenvectors().col(i)); eigenvalues.push_back(eig.eigenvalues()[i]); }
    } else {
        Vector massScale(count); for (int i=0;i<count;++i) massScale[i]=1/std::sqrt(mass.coeff(i,i));
        const Sparse scaledMass=massScale.asDiagonal()*mass*massScale.asDiagonal();
        Eigen::SimplicialLLT<Sparse> massFactor(scaledMass);
        if (massFactor.info()!=Eigen::Success) throw Failure("modal-singular-mass","Mass matrix is not positive definite",nullptr,"densityKgM3");
        const Sparse massLower=massFactor.matrixL();
        for (int i=0;i<count;++i) if (!std::isfinite(massLower.coeff(i,i)) || massLower.coeff(i,i)*massLower.coeff(i,i)<=1e-12)
            throw Failure("modal-singular-mass","Scaled mass pivot is below the registered tolerance",nullptr,"densityKgM3");
        // A small mass shift permits rigid-body modes without adding physical
        // stiffness. Subtract it from the recovered eigenvalues and validate
        // each pair against the original, unshifted matrices below.
        const Sparse scaledStiffness=massScale.asDiagonal()*k*massScale.asDiagonal();
        const auto maximum=largestSparseEigenpairs(scaledMass,scaledStiffness,1,"modal-spectrum",true,true);
        zeroThreshold=std::max(1.0,maximum.values[0])*1e-12;
        const double shift=zeroThreshold*10;
        const Sparse shifted=k+shift*mass;
        int spectralCount=extracted;
        auto eig=largestSparseEigenpairs(shifted,mass,spectralCount,"modal");
        while (spectralCount<count && std::abs(1/eig.values[spectralCount-1]-shift)<=zeroThreshold) {
            spectralCount=std::min(count,std::max(spectralCount+8,spectralCount*2));
            eig=largestSparseEigenpairs(shifted,mass,spectralCount,"modal");
        }
        for (int i=0;i<spectralCount;++i) if (std::abs(1/eig.values[i]-shift)<=zeroThreshold) ++zeroCount;
        for (int i=0;i<extracted;++i) {
            Vector q=eig.vectors.col(i); q/=std::sqrt(q.dot(mass*q));
            const double value=1/eig.values[i]-shift;
            if (!std::isfinite(value) || value < -zeroThreshold) throw Failure("modal-negative-stiffness","Negative sparse modal eigenvalue",nullptr,"restraints");
            eigenvalues.push_back(value); eigenvectors.push_back(q);
        }
    }
    Json modes=Json::array(); double orthogonality=0;
    for (int i=0;i<extracted;++i) for (int j=0;j<=i;++j) orthogonality=std::max(orthogonality,std::abs(eigenvectors[i].dot(mass*eigenvectors[j])-(i==j ? 1.0 : 0.0)));
    if (!std::isfinite(orthogonality) || orthogonality>1e-8) throw Failure("modal-orthogonality-failed","Mass orthogonality exceeds tolerance",nullptr,"modal");
    for (int mode=0;mode<extracted;++mode) {
        const Vector& q=eigenvectors[mode]; const double lambda=std::abs(eigenvalues[mode])<=zeroThreshold ? 0 : eigenvalues[mode];
        const double residual=(k*q-lambda*(mass*q)).norm()/std::max(1e-30,k.norm()*q.norm()+std::abs(lambda)*(mass*q).norm());
        if (!std::isfinite(residual) || residual>1e-8) throw Failure("modal-residual-failed","Eigenpair residual exceeds tolerance",nullptr,"modal");
        Vector u=Vector::Zero(assembly.size); for (int i=0;i<nodal;++i) u[assembly.free[i]]=q[i];
        Json nodes=Json::array(), members=Json::array();
        const bool compactShape=count>144;
        if (compactShape) {
            // For target-scale results the frozen eigenproblem vectors are the
            // canonical shape representation. The renderer and random adapter
            // reconstruct node/member samples from those vectors, avoiding a
            // second multi-hundred-megabyte JSON tree in the native worker.
            nodes=Json::array(); members=Json::array();
        }
        if (!compactShape) for (size_t i=0;i<input.at("nodes").size();++i) nodes.push_back({{"nodeId",input["nodes"][i]["id"]},{"translation",json3(u.segment<3>(i*6))},{"rotation",json3(u.segment<3>(i*6+3))}});
        size_t offset=0; const int divisions=level.at("divisions").get<int>();
        for (const auto& m:input.at("members")) if (!compactShape) {
            const double length=number(input["meshPlan"]["frames"][id(m["id"])]["length"]); Json samples=Json::array();
            for (int station=0;station<=16;++station) {
                const int scaled=station*divisions, segment=std::min(divisions-1,scaled/16); const double t=(scaled-segment*16)/16.0;
                const auto index=offset+segment; const auto& e=assembly.elements[index]; const Vector v=mappedLocalVector(maps[index],q);
                const double h0=1-3*t*t+2*t*t*t, h1=e.length*(t-2*t*t+t*t*t), h2=3*t*t-2*t*t*t, h3=e.length*(-t*t+t*t*t);
                const Vec3 local((1-t)*v[0]+t*v[6],h0*v[1]+h1*v[5]+h2*v[7]+h3*v[11],h0*v[2]-h1*v[4]+h2*v[8]-h3*v[10]);
                samples.push_back({{"position",length*station/16},{"translation",json3(e.x*local.x()+e.y*local.y()+e.z*local.z())}});
            }
            members.push_back({{"memberId",m["id"]},{"samples",samples}}); offset+=divisions;
        }
        Json record={{"number",mode+1},{"eigenvalue",lambda},{"frequencyHz",std::sqrt(lambda)/(2*std::acos(-1.0))},{"kind",lambda==0 ? "zero-energy" : "elastic"},
            {"residual",residual},{"massNorm",q.dot(mass*q)},{"nodes",nodes},{"members",members}};
        if (compactShape) record["shapeEncoding"]="eigenproblem-v1";
        modes.push_back(std::move(record));
    }
    Json coordinates=Json::array(), capturedVectors=Json::array();
    for (int index:assembly.free) coordinates.push_back({{"kind","node"},{"id",calculationNodeIds[index/6]},{"dof",dofOrder[index%6]}});
    for (const auto& e:assembly.elements) for (int index:e.released) coordinates.push_back({{"kind","release"},{"id",e.member["id"]},{"dof",std::string(index<6 ? "start." : "end.")+(index%6==4 ? "my" : "mz")}});
    for (int i=0;i<extracted;++i) capturedVectors.push_back(jsonVector(eigenvectors[i]));
    Json eigenproblem={{"matrixLimit",144},{"coordinates",coordinates},{"releaseNullRotations",assembly.releaseNullRotations},{"vectors",capturedVectors},
        {"stiffness",count<=144 ? jsonMatrix(Matrix(k)) : Json(nullptr)},{"mass",count<=144 ? jsonMatrix(Matrix(mass)) : Json(nullptr)}};
    return {modes,count,releases,zeroCount,orthogonality,zeroThreshold,eigenproblem};
}

static Json calculateModal(const Json& request, Json& stages, std::string& stage) {
    auto phase=[&](const std::string& name) { stage=name; Json record={{"stage",name},{"startedAt",now()}}; stages.push_back(record); emit({{"kind","phase"},{"requestId",request.at("requestId")},{"record",record}}); };
    phase("model-check"); const auto& input=request.at("input"); const auto& definition=input.at("analysisCase");
    for (const auto& collection:{"nodes","members"}) for (const auto& object:input.at(collection)) {
        const std::string field=std::string(collection)=="nodes" ? "additionalMassKg" : "additionalLineMassKgM";
        if (object.contains(field)) {
            const Json target={{"kind",std::string(collection)=="nodes" ? "node" : "member"},{"id",object.at("id")}};
            require(object.at(field).is_number(),"Added mass must be a nonnegative finite scalar",target,field);
            const double value=number(object.at(field));
            require(std::isfinite(value) && value>=0,"Added mass must be a nonnegative finite scalar",target,field);
        }
    }
    const Json modalSolver={{"implementation","framemind-native/5"},{"algorithm","generalized-self-adjoint"},{"constraints","free-dof-elimination"},{"relativePivotTolerance",1e-12}};
    require(input.at("solver")==modalSolver && definition.at("method")=="modal" && definition.at("loadSourceId")=="structure"
        && definition.at("settings").is_object() && definition.at("settings").size()==2 && definition.at("settings").at("solver")=="native-modal", "Unsupported modal contract");
    // Reuse static identity validation on an isolated copy, with no fabricated loads.
    Json identityInput=input; identityInput["analysisCase"]["method"]="static"; identityInput["analysisCase"]["loadSourceId"]=input.at("loadCase").at("id"); identityInput["analysisCase"]["settings"]={{"solver","native-static"}};
    analysisCaseSource(identityInput,input.at("loadCase").at("id"));
    require(request.at("sourceId")==definition.at("id") && request.at("dependencies")==Json::array(),"Modal source mismatch");
    require(input.at("nodalLoads").empty() && input.at("uniformLoads").empty() && input.at("selfWeight").at("enabled")==false && !input.contains("combination"),"Static loads are not modal mass");
    const auto& settings=definition.at("settings").at("modal");
    require(settings.is_object() && settings.size()==4,"Invalid modal parameters");
    const double requested=number(settings.at("modeCount")), budget=number(settings.at("maxEquations")), divisionsValue=number(settings.at("maxDivisions")), tolerance=number(settings.at("frequencyTolerance"));
    require(requested>=1 && requested<=50 && std::floor(requested)==requested && budget>=1 && budget<=2147483647 && std::floor(budget)==budget
        && (divisionsValue==1 || divisionsValue==2 || divisionsValue==4 || divisionsValue==8 || divisionsValue==16) && tolerance>0 && tolerance<=0.01,"Invalid modal extraction parameters");
    const int modeCount=static_cast<int>(requested), maxEquations=static_cast<int>(budget), maxDivisions=static_cast<int>(divisionsValue);
    const auto& plan=input.at("meshPlan");
    const Json policy={{"maxDivisions",maxDivisions},{"maxEquations",maxEquations},{"relativeTolerance",1e-6},{"displacementTolerance",1e-12},{"forceTolerance",1e-8}};
    require(meshNumbersMatch(plan.at("policy"),policy) && meshNumbersMatch(plan.at("frames"),meshFrames(input)),"Modal mesh policy or frames mismatch");
    int levels=0; for (int d=1;d<=maxDivisions;d*=2) { require(levels<static_cast<int>(plan.at("levels").size()) && meshNumbersMatch(plan["levels"][levels],meshLevel(input,d)),"Modal mesh mapping mismatch"); ++levels; }
    require(levels==static_cast<int>(plan.at("levels").size()),"Unexpected modal mesh levels");
    Json runs=Json::array(); ModalLevelResult finalResult; Json selectedLevel;
    std::string status="budget-exhausted", reason="max-divisions";
    for (const auto& level:plan.at("levels")) {
        // Conservative budget before constructing any dense matrices; releases
        // at engineering ends add independent beam-end coordinates.
        std::set<std::pair<std::string,int>> constrained;
        for (const auto& support:input.at("supports")) for (int d=0;d<6;++d) if (support.at("restraints")[d]==true) constrained.insert({id(support["nodeId"]),d});
        int releases=0; for (const auto& m:input.at("members")) if (m.contains("endReleases")) for (const auto& end:{"start","end"}) for (const auto& component:{"my","mz"}) if (m["endReleases"][end][component]==true) ++releases;
        const size_t estimate=(input.at("nodes").size()+level.at("nodes").size())*6-constrained.size()+releases;
        if (!estimate) continue; // An all-fixed /1 mesh has no internal dynamic coordinates; refine it.
        if (estimate>static_cast<size_t>(maxEquations)) {
            if (runs.empty()) throw Failure("modal-budget-exhausted","模态初始网格需要 " + std::to_string(estimate) + " 个方程，超过当前 " + std::to_string(maxEquations) + " 方程预算。未开始求解；请使用可承载该规模的求解配置。",nullptr,"modal");
            reason="equation-budget"; break;
        }
        finalResult=solveModalLevel(request,level,modeCount,maxEquations,stage,runs.empty() ? std::function<void(const std::string&)>(phase) : std::function<void(const std::string&)>()); selectedLevel=level;
        Json frequencies=Json::array(); for (const auto& m:finalResult.modes) frequencies.push_back(m["frequencyHz"]);
        Json run={{"divisions",level["divisions"]},{"equations",finalResult.equations},{"frequenciesHz",frequencies}};
        if (!runs.empty() && frequencies.size()==static_cast<size_t>(modeCount) && runs.back()["frequenciesHz"].size()==frequencies.size()) {
            double error=0; for (size_t i=0;i<frequencies.size();++i) { const double a=number(frequencies[i]), b=number(runs.back()["frequenciesHz"][i]); error=std::max(error,std::abs(a-b)/std::max(1e-8,std::max(a,b))); }
            run["error"]=error; if (error<=tolerance) { status="converged"; reason="frequency-tolerance"; }
        }
        runs.push_back(run); if (status=="converged") break;
    }
    if (runs.empty()) throw Failure("modal-budget-exhausted","Equation budget prevents even the initial modal mesh",nullptr,"modal");
    phase("recovery"); Json sources=Json::array(); double total=0;
    for (const auto& m:input.at("members")) {
        Json material, section; for (const auto& v:input.at("materials")) if (v["id"]==m["materialId"]) material=v; for (const auto& v:input.at("sections")) if (v["id"]==m["sectionId"]) section=v;
        const double length=number(plan.at("frames").at(id(m["id"])).at("length")), density=number(material.at("densityKgM3")), mass=density*number(section.at("areaM2"))*length; total+=mass;
        sources.push_back({{"memberId",m["id"]},{"materialId",m["materialId"]},{"sectionId",m["sectionId"]},{"densityKgM3",density},{"lengthM",length},{"massKg",mass}});
    }
    Json additionalSources=Json::array(); double additional=0;
    for (const auto& node:input.at("nodes")) {
        const double point=node.contains("additionalMassKg") ? number(node.at("additionalMassKg")) : 0;
        if (point>0) { additional+=point; additionalSources.push_back({{"kind","point"},{"nodeId",node["id"]},{"massKg",point}}); }
    }
    for (const auto& member:input.at("members")) {
        const double line=member.contains("additionalLineMassKgM") ? number(member.at("additionalLineMassKgM")) : 0;
        const double length=number(plan.at("frames").at(id(member["id"])).at("length")), amount=line*length;
        if (line>0) { additional+=amount; additionalSources.push_back({{"kind","line"},{"memberId",member["id"]},{"massPerLengthKgM",line},{"lengthM",length},{"massKg",amount}}); }
    }
    require(std::isfinite(total) && std::isfinite(additional) && std::isfinite(total+additional),"Nonfinite total mass",nullptr,"mass");
    Json modal={{"massModel","consistent-eb-with-torsional-inertia"},{"normalization","unit-generalized-mass"},{"massUnit","kN·s²/m"},{"totalMassKg",total+additional},{"sources",sources},
        {"structuralMassKg",total},{"additionalMassKg",additional},{"additionalSources",additionalSources},
        {"modes",finalResult.modes},{"orthogonalityError",finalResult.orthogonalityError},{"zeroEnergyModes",finalResult.zeroEnergyModes},{"zeroEigenvalueTolerance",finalResult.zeroEigenvalueTolerance},{"eigenproblem",finalResult.eigenproblem},{"selectedDivisions",selectedLevel["divisions"]},
        {"convergence",{{"status",status},{"reason",reason},{"runs",runs}}},
        {"counts",{{"engineeringNodes",input.at("nodes").size()},{"engineeringMembers",input.at("members").size()},{"calculationNodes",input.at("nodes").size()+selectedLevel.at("nodes").size()},
        {"calculationElements",selectedLevel.at("elements").size()},{"equations",finalResult.equations},{"releaseCoordinates",finalResult.releaseCoordinates}}}};
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},
        {"origin",request["origin"]},{"sourceId",request["sourceId"]},{"dependencies",Json::array()},{"solver",modalSolver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},
        {"nodes",Json::array()},{"members",Json::array()},{"modal",modal},{"service",service}};
}
