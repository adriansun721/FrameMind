// Full static adapter. Shared protocol, geometry and element helpers live in main.cpp.
using Sparse = Eigen::SparseMatrix<double>;
using Triplet = Eigen::Triplet<double>;
static const Json legacyStaticSolver={{"implementation","framemind-native/2"},{"algorithm","sparse-ldlt"},
    {"constraints","free-dof-elimination"},{"relativePivotTolerance",1e-12}};

static void check(bool condition, const std::string& code, const std::string& message, Json target, const std::string& field) {
    if (!condition) throw Failure(code,message,target,field);
}
static double staticParameter(const Json& value, const std::string& kind, const std::string& field, bool positive) {
    try { return parameter(value,kind,field,positive); }
    catch (Failure& failure) { failure.diagnostic["code"]="invalid-parameter"; throw; }
}
struct StaticElement {
    Json member;
    double length, density, area;
    Vec3 x,y,z;
    Matrix local, transform, global, original, recovery;
    std::vector<int> released;
    Matrix releaseInverse;
    std::vector<int> indices;
};
struct StaticLoads {
    Vector nodal;
    std::vector<Vec3> intensity;
};

static Json calculateStatic(const Json& request, Json& stages, std::string& stage, bool publishPhases=true, bool inheritedFrames=false) {
    auto phase=[&](const std::string& name) {
        stage=name; Json record={{"stage",name},{"startedAt",now()}}; stages.push_back(record);
        if (publishPhases) emit({{"kind","phase"},{"requestId",request.at("requestId")},{"record",record}});
    };
    phase("model-check"); id(request.at("requestId")); id(request.at("analysisId"));
    const auto& input=request.at("input");
    require(inheritedFrames || !input.contains("calculationFrames"),"Inherited frames are private to mesh runs");
    Json staticSolver=legacyStaticSolver;
    if (input.at("solver").at("implementation")=="framemind-native/3") staticSolver["implementation"]="framemind-native/3";
    require(request.at("version")=="framemind-analysis/1" && input.at("solver")==staticSolver && input.at("dofOrder")==dofOrder,"Unsupported static contract");
    id(input.at("projectId")); const double revision=number(input.at("projectRevision"));
    require(revision>=0 && revision<=9007199254740991.0 && std::floor(revision)==revision,"Invalid project revision");
    Json assumptions=input.at("assumptions");
    require(assumptions.at("rigidJoints").is_boolean(),"Invalid joint assumption");
    const bool rigidJoints=assumptions.at("rigidJoints").get<bool>(); assumptions["rigidJoints"]=true;
    require(assumptions==Json({{"theory","3d-euler-bernoulli-frame"},{"shearDeformation","neglected"},
        {"rigidJoints",true},{"units","m-kN-kN·m"},{"localAxis","member-geometry"}}),"Unsupported units or theory");
    const auto& origin=request.at("origin");
    const auto kind=origin.at("kind");
    const bool diagnostic=kind=="diagnostic-copy" && origin.at("copyId")==input.at("projectId")
        && id(origin.at("sourceProjectId"))!=input.at("projectId").get<std::string>()
        && number(origin.at("sourceProjectRevision"))>=0
        && std::floor(number(origin.at("sourceProjectRevision")))==number(origin.at("sourceProjectRevision"))
        && number(origin.at("sourceProjectRevision"))<=9007199254740991.0
        && (!origin.contains("sourceAnalysisId") || !id(origin.at("sourceAnalysisId")).empty());
    const bool supplemental=kind=="supplemental" && !id(origin.at("sourceAnalysisId")).empty();
    require(kind=="formal-model" || diagnostic || supplemental,"Unsupported static origin");
    const auto& nodes=input.at("nodes"); const auto& members=input.at("members");
    require(nodes.is_array() && !nodes.empty() && members.is_array() && !members.empty(),"Missing nodes or members");
    std::map<std::string,int> nodeIndex, memberIndex;
    for (const auto& entry:std::vector<std::pair<std::string,std::string>>{{"nodes","node"},{"members","member"},{"materials","material"},{"sections","section"},{"supports","support"}}) {
        require(input.at(entry.first).is_array(),"Invalid object array"); std::set<std::string> seen;
        for (const auto& object:input.at(entry.first)) {
            const auto identity=id(object.at("id"));
            check(seen.insert(identity).second,"invalid-identity","Duplicate object identity",{{"kind",entry.second},{"id",identity}},"id");
        }
    }
    std::vector<Vec3> positions;
    for (size_t i=0;i<nodes.size();++i) {
        nodeIndex[id(nodes[i].at("id"))]=static_cast<int>(i);
        positions.push_back(vector3(nodes[i].at("position"),{{"kind","node"},{"id",nodes[i]["id"]}},"position"));
    }
    std::map<std::string,Json> materials, sections;
    for (const auto& material:input.at("materials")) {
        staticParameter(material,"material","elasticModulusGPa",true);
        staticParameter(material,"material","densityKgM3",true);
        const double nu=staticParameter(material,"material","poissonRatio",false);
        check(nu>-1 && nu<0.5,"invalid-parameter","Invalid Poisson ratio",{{"kind","material"},{"id",material["id"]}},"poissonRatio");
        materials[id(material.at("id"))]=material;
    }
    for (const auto& section:input.at("sections")) {
        for (const auto& field:{"areaM2","secondMomentYM4","secondMomentZM4","torsionalConstantM4"}) staticParameter(section,"section",field,true);
        sections[id(section.at("id"))]=section;
    }
    std::vector<Matrix> rotationConnectivity(nodes.size(),Matrix::Zero(3,3));
    std::vector<StaticElement> elements; std::vector<std::vector<int>> adjacency(nodes.size());
    for (const auto& member:members) {
        const Json target={{"kind","member"},{"id",member["id"]}};
        auto reference=[&](const auto& map,const std::string& field) {
            const auto key=id(member.at(field));
            check(map.count(key)!=0,"invalid-reference","Missing referenced object",target,field); return map.at(key);
        };
        const int start=reference(nodeIndex,"startNodeId"), end=reference(nodeIndex,"endNodeId");
        const auto material=reference(materials,"materialId"), section=reference(sections,"sectionId");
        const Vec3 delta=positions[end]-positions[start]; double length=delta.norm();
        check(std::isfinite(length) && length>1e-12,"invalid-geometry","Invalid member length",target,"endNodeId");
        adjacency[start].push_back(end); adjacency[end].push_back(start);
        const double angle=staticParameter(member,"member","rotationDegrees",false)*std::acos(-1.0)/180;
        Vec3 x=delta/length; const Vec3 ref=std::abs(x.z())<0.9-1e-12 ? Vec3(0,0,1) : Vec3(0,1,0);
        const Vec3 baseY=ref.cross(x).normalized(), baseZ=x.cross(baseY);
        Vec3 y=baseY*std::cos(angle)+baseZ*std::sin(angle), z=-baseY*std::sin(angle)+baseZ*std::cos(angle);
        if (inheritedFrames) {
            const auto& frame=input.at("calculationFrames").at(id(member["id"]));
            const double inheritedLength=number(frame.at("length"));
            check(inheritedLength>1e-12 && std::abs(inheritedLength-length)<=1e-9*std::max(1.0,length),"invalid-geometry","Inherited element length mismatch",target,"calculationFrames");
            x=vector3(frame.at("localX"),target,"calculationFrames"); y=vector3(frame.at("localY"),target,"calculationFrames"); z=vector3(frame.at("localZ"),target,"calculationFrames"); length=inheritedLength;
            check(std::abs(x.norm()-1)<1e-12 && std::abs(y.norm()-1)<1e-12 && std::abs(z.norm()-1)<1e-12 && (x.cross(y)-z).norm()<1e-12,"invalid-geometry","Invalid inherited local frame",target,"calculationFrames");
        }
        Matrix transform=Matrix::Zero(12,12);
        for (int block=0;block<4;++block) {
            transform.block<1,3>(block*3,block*3)=x.transpose(); transform.block<1,3>(block*3+1,block*3)=y.transpose(); transform.block<1,3>(block*3+2,block*3)=z.transpose();
        }
        Matrix local=stiffness(length,number(material["elasticModulusGPa"])*1e6,number(material["poissonRatio"]),
            number(section["areaM2"]),number(section["secondMomentYM4"]),number(section["secondMomentZM4"]),number(section["torsionalConstantM4"]));
        std::vector<int> released;
        bool releaseMy[2]={false,false}, releaseMz[2]={false,false};
        if (member.contains("endReleases")) {
            const auto& ends=member.at("endReleases");
            check(ends.is_object() && ends.size()==2 && ends.contains("start") && ends.contains("end"),"invalid-release","End releases require start and end",target,"endReleases");
            int endpoint=0;
            for (const auto& key:{"start","end"}) {
                const auto& r=ends.at(key);
                check(r.is_object() && r.size()==2 && r.contains("my") && r.contains("mz") && r.at("my").is_boolean() && r.at("mz").is_boolean(),"invalid-release","Only boolean local My/Mz releases are supported",target,"endReleases");
                releaseMy[endpoint]=r.at("my").get<bool>(); releaseMz[endpoint]=r.at("mz").get<bool>();
                if (releaseMy[endpoint]) released.push_back(endpoint*6+4);
                if (releaseMz[endpoint]) released.push_back(endpoint*6+5);
                ++endpoint;
            }
        }
        check(released.empty() || staticSolver.at("implementation")=="framemind-native/3","unsupported-release","Releases require the /3 numerical implementation",target,"endReleases");
        Matrix original=local, recovery=Matrix::Identity(12,12), releaseInverse;
        if (!released.empty()) {
            const int n=static_cast<int>(released.size()); Matrix rr(n,n);
            for (int r=0;r<n;++r) for (int c=0;c<n;++c) rr(r,c)=original(released[r],released[c]);
            Eigen::LDLT<Matrix> decomposition(rr);
            check(decomposition.info()==Eigen::Success && decomposition.isPositive(),"invalid-release","Release block is singular",target,"endReleases");
            releaseInverse=decomposition.solve(Matrix::Identity(n,n));
            for (int index:released) recovery.row(index).setZero();
            for (int c=0;c<12;++c) if (std::find(released.begin(),released.end(),c)==released.end()) {
                Vector coupling(n); for (int r=0;r<n;++r) coupling[r]=original(released[r],c);
                const Vector coefficients=-releaseInverse*coupling;
                for (int r=0;r<n;++r) recovery(released[r],c)=coefficients[r];
            }
            local=recovery.transpose()*original*recovery;
            local=(local+local.transpose()).eval()/2;
            for (int index:released) { local.row(index).setZero(); local.col(index).setZero(); }
        }
        for (int endpoint=0;endpoint<2;++endpoint) {
            auto& connectivity=rotationConnectivity[endpoint==0 ? start : end];
            connectivity+=x*x.transpose();
            if (!releaseMy[endpoint]) connectivity+=y*y.transpose();
            if (!releaseMz[endpoint]) connectivity+=z*z.transpose();
        }
        std::vector<int> indices; for (int node:{start,end}) for (int d=0;d<6;++d) indices.push_back(node*6+d);
        memberIndex[id(member.at("id"))]=static_cast<int>(elements.size());
        elements.push_back({member,length,number(material["densityKgM3"]),number(section["areaM2"]),x,y,z,local,transform,transform.transpose()*local*transform,original,recovery,released,releaseInverse,indices});
    }
    const bool hasReleases=std::any_of(elements.begin(),elements.end(),[](const StaticElement& e) { return !e.released.empty(); });
    require(rigidJoints==!hasReleases,"Joint assumption does not match explicit member releases");
    const int size=static_cast<int>(nodes.size()*6); std::vector<bool> restrained(size,false);
    for (const auto& support:input.at("supports")) {
        const Json target={{"kind","support"},{"id",support["id"]}}; const auto key=id(support.at("nodeId"));
        check(nodeIndex.count(key)!=0,"invalid-reference","Missing support node",target,"nodeId");
        const auto& values=support.at("restraints");
        require(values.is_array() && values.size()==6,"Invalid support DOFs",target,"restraints");
        for (int d=0;d<6;++d) { require(values[d].is_boolean(),"Invalid restraint",target,"restraints"); restrained[nodeIndex.at(key)*6+d]=restrained[nodeIndex.at(key)*6+d] || values[d].get<bool>(); }
    }
    std::set<int> visited;
    for (int root=0;root<static_cast<int>(nodes.size());++root) {
        if (visited.count(root)) continue;
        const Json target={{"kind","node"},{"id",nodes[root]["id"]}};
        check(!adjacency[root].empty(),"isolated-node","Node is not connected to any member",target,"connectivity");
        bool supported=false; std::vector<int> pending={root};
        while (!pending.empty()) {
            const int node=pending.back(); pending.pop_back(); if (!visited.insert(node).second) continue;
            for (int d=0;d<6;++d) supported=supported || restrained[node*6+d];
            for (int next:adjacency[node]) if (!visited.count(next)) pending.push_back(next);
        }
        check(supported,"unrestrained-component","Connected component has no restrained DOFs",target,"restraints");
    }
    auto loadSet=[&](const Json& data,const Json& caseId) {
        StaticLoads loads={Vector::Zero(size),std::vector<Vec3>(elements.size(),Vec3::Zero())};
        for (const auto& key:{"nodalLoads","uniformLoads"}) {
            require(data.at(key).is_array(),"Invalid load array"); std::set<std::string> seen;
            for (const auto& load:data.at(key)) {
                const Json target={{"kind",std::string(key)=="nodalLoads" ? "load" : "uniform-load"},{"id",load.at("id")}};
                check(seen.insert(id(load.at("id"))).second,"invalid-identity","Duplicate load identity",target,"id");
                require(load.at("loadCaseId")==caseId,"Invalid load case reference",target,"loadCaseId");
                if (std::string(key)=="nodalLoads") {
                    const auto node=id(load.at("nodeId")); check(nodeIndex.count(node)!=0,"invalid-reference","Missing load node",target,"nodeId");
                    const int offset=nodeIndex.at(node)*6;
                    loads.nodal.segment<3>(offset)+=vector3(load.at("force"),target,"force"); loads.nodal.segment<3>(offset+3)+=vector3(load.at("moment"),target,"moment");
                } else {
                    const auto member=id(load.at("memberId")); check(memberIndex.count(member)!=0,"invalid-reference","Missing loaded member",target,"memberId");
                    require(load.at("kind")=="uniform" && (load.at("coordinateSystem")=="global" || load.at("coordinateSystem")=="local"),"Invalid uniform load coordinates",target,"coordinateSystem");
                    const int index=memberIndex.at(member); const auto& e=elements[index]; const Vec3 q=vector3(load.at("intensity"),target,"intensity");
                    loads.intensity[index]+=load.at("coordinateSystem")=="local" ? q : Vec3(e.x.dot(q),e.y.dot(q),e.z.dot(q));
                }
            }
        }
        const auto& weight=data.at("selfWeight"); const Json target={{"kind","self-weight"},{"id",input["projectId"]}};
        require(weight.at("loadCaseId")==caseId && weight.at("enabled").is_boolean(),"Invalid self-weight case",target,"selfWeight");
        const Vec3 gravity=vector3(weight.at("gravity"),target,"gravity");
        if (weight.at("enabled").get<bool>()) for (size_t i=0;i<elements.size();++i) {
            const auto& e=elements[i]; const Vec3 q=gravity*(e.density*e.area/1000);
            loads.intensity[i]+=Vec3(e.x.dot(q),e.y.dot(q),e.z.dot(q));
        }
        return loads;
    };
    const Json caseId=input.at("loadCase").at("id"); id(caseId);
    StaticLoads loads=loadSet(input,caseId); Json source=caseId, dependencies=Json::array({{{"loadCaseId",caseId},{"factor",1}}});
    if (input.contains("combination")) {
        const auto& combination=input.at("combination"); source=combination.at("definition").at("id"); id(source);
        const Json target={{"kind","load-combination"},{"id",source}};
        const auto& terms=combination.at("definition").at("terms"); const auto& cases=combination.at("cases");
        require(terms.is_array() && !terms.empty() && cases.is_array() && terms.size()==cases.size(),"Invalid combination cases",target,"combination.cases");
        dependencies=Json::array(); StaticLoads weighted={Vector::Zero(size),std::vector<Vec3>(elements.size(),Vec3::Zero())}; std::set<std::string> seen;
        for (size_t i=0;i<terms.size();++i) {
            const auto& term=terms[i]; const auto& c=cases[i];
            const std::string casePath="combination.cases["+std::to_string(i)+"]", termPath="combination.definition.terms["+std::to_string(i)+"]";
            require(c.size()==4 && c.contains("loadCase") && c.contains("nodalLoads") && c.contains("uniformLoads") && c.contains("selfWeight"),"Combination must share structural input",target,casePath);
            require(term.contains("loadCaseId") && c.at("loadCase").contains("id") && term.at("loadCaseId")==c.at("loadCase").at("id") && seen.insert(id(term.at("loadCaseId"))).second,"Invalid combination case order or duplicate",target,casePath+".loadCase.id");
            require(term.contains("factor") && term.at("factor").is_number() && std::isfinite(term.at("factor").get<double>()),"Invalid combination coefficient",target,termPath+".factor");
            const double factor=term.at("factor").get<double>(); dependencies.push_back(term); const auto part=loadSet(c,term.at("loadCaseId"));
            weighted.nodal+=factor*part.nodal; for (size_t j=0;j<elements.size();++j) weighted.intensity[j]+=factor*part.intensity[j];
        }
        // Validate, then solve only the effective loads. Do not weight them again.
        for (int index=0;index<size;++index) if (!std::isfinite(weighted.nodal[index]) || !std::isfinite(loads.nodal[index]) || std::abs(weighted.nodal[index]-loads.nodal[index])>1e-9) {
            Failure failure("native-input-error","Combination effective nodal loads mismatch",{{"kind","node"},{"id",nodes[index/6]["id"]}},std::string(index%6<3 ? "force." : "moment.")+"xyz"[index%3]);
            failure.diagnostic["dof"]=dofOrder[index%6]; throw failure;
        }
        for (size_t i=0;i<elements.size();++i) for (int axis=0;axis<3;++axis) require(std::isfinite(weighted.intensity[i][axis]) && std::isfinite(loads.intensity[i][axis]) && std::abs(weighted.intensity[i][axis]-loads.intensity[i][axis])<=1e-9,
            "Combination effective distributed loads mismatch",{{"kind","member"},{"id",elements[i].member["id"]}},std::string("intensity.")+"xyz"[axis]);
    }
    source=analysisCaseSource(input,source);
    require(request.at("sourceId")==source && request.at("dependencies")==dependencies,"Source dependency mismatch");
    phase("assembly");
    Vector force=loads.nodal; std::vector<Vector> equivalentLocal, equivalentGlobal, originalEquivalent, releaseOffsets; std::vector<Triplet> entries;
    for (size_t i=0;i<elements.size();++i) {
        const auto& e=elements[i]; const Vec3 q=loads.intensity[i]; const double half=e.length/2, moment=e.length*e.length/12;
        Vector eq(12); eq<<q.x()*half,q.y()*half,q.z()*half,0,-q.z()*moment,q.y()*moment,q.x()*half,q.y()*half,q.z()*half,0,q.z()*moment,-q.y()*moment;
        originalEquivalent.push_back(eq);
        Vector offset=Vector::Zero(12);
        if (!e.released.empty()) {
            Vector fr(e.released.size()); for (size_t r=0;r<e.released.size();++r) fr[r]=eq[e.released[r]];
            const Vector solved=e.releaseInverse*fr;
            for (size_t r=0;r<e.released.size();++r) offset[e.released[r]]=solved[r];
            eq=e.recovery.transpose()*eq;
        }
        releaseOffsets.push_back(offset);
        Vector globalEq=e.transform.transpose()*eq;
        if (!e.global.allFinite() || !eq.allFinite() || !globalEq.allFinite()) throw Failure("native-computation-error","Nonfinite element assembly",{{"kind","member"},{"id",e.member["id"]}},"stiffness");
        equivalentLocal.push_back(eq); equivalentGlobal.push_back(globalEq);
        for (int r=0;r<12;++r) { force[e.indices[r]]+=globalEq[r]; for (int c=0;c<12;++c) if (e.global(r,c)!=0) entries.emplace_back(e.indices[r],e.indices[c],e.global(r,c)); }
    }
    Sparse global(size,size); global.setFromTriplets(entries.begin(),entries.end()); global.makeCompressed();
    for (int i=0;i<global.nonZeros();++i) if (!std::isfinite(global.valuePtr()[i])) throw Failure("native-computation-error","Nonfinite assembled stiffness");
    if (!force.allFinite()) throw Failure("native-computation-error","Nonfinite assembled load");
    // Remove only rotations disconnected by explicit member releases. These are
    // coordinate gauges, never supports or added stiffness. Geometry (not stiffness
    // magnitude) determines the null directions, including rotated local axes.
    std::vector<bool> gauge(size,false); std::vector<int> releaseGaugeDofs;
    Json releaseNullRotations=Json::array();
    for (size_t node=0;node<nodes.size();++node) {
        Matrix connectivity=rotationConnectivity[node];
        for (int d=0;d<3;++d) if (restrained[node*6+3+d]) connectivity(d,d)+=1;
        for (int pass=0;pass<3;++pass) {
            Eigen::SelfAdjointEigenSolver<Matrix> eig(connectivity);
            check(eig.info()==Eigen::Success,"native-computation-error","Rotation connectivity decomposition failed",{{"kind","node"},{"id",nodes[node]["id"]}},"endReleases");
            if (eig.eigenvalues()[0]>eig.eigenvalues().maxCoeff()*1e-12) break;
            const Vec3 direction=eig.eigenvectors().col(0);
            const double moment=direction.dot(force.segment<3>(node*6+3));
            check(std::abs(moment)<=1e-9,"unresisted-release-moment","A nodal moment acts in a completely released rotation direction",{{"kind","node"},{"id",nodes[node]["id"]}},"endReleases");
            int coordinate=0; direction.cwiseAbs().maxCoeff(&coordinate);
            const int index=static_cast<int>(node*6+3+coordinate);
            gauge[index]=true; releaseGaugeDofs.push_back(index);
            releaseNullRotations.push_back({{"nodeId",nodes[node]["id"]},{"direction",json3(direction)},{"gaugeDof",index}});
            connectivity(coordinate,coordinate)+=1;
        }
    }
    std::sort(releaseGaugeDofs.begin(),releaseGaugeDofs.end());
    std::vector<int> free, constrained, reducedIndex(size,-1);
    for (int i=0;i<size;++i) if (restrained[i]) constrained.push_back(i); else if (!gauge[i]) { reducedIndex[i]=static_cast<int>(free.size()); free.push_back(i); }
    std::vector<Triplet> reducedEntries;
    for (int c=0;c<global.outerSize();++c) for (Sparse::InnerIterator it(global,c);it;++it) if (reducedIndex[it.row()]>=0 && reducedIndex[it.col()]>=0) reducedEntries.emplace_back(reducedIndex[it.row()],reducedIndex[it.col()],it.value());
    const int count=static_cast<int>(free.size()); Sparse reduced(count,count); reduced.setFromTriplets(reducedEntries.begin(),reducedEntries.end()); reduced.makeCompressed();
    Vector rhs(count); for (int i=0;i<count;++i) rhs[i]=force[free[i]];
    phase("solve"); Vector displacement=Vector::Zero(size);
    if (count) {
        // Natural order keeps failed pivots directly mapped to engineering DOFs.
        Eigen::SimplicialLDLT<Sparse,Eigen::Lower,Eigen::NaturalOrdering<int>> factorization;
        factorization.compute(reduced);
        const Vector pivots=factorization.vectorD(); double matrixScale=0;
        for (int i=0;i<reduced.nonZeros();++i) matrixScale=std::max(matrixScale,std::abs(reduced.valuePtr()[i]));
        const double threshold=matrixScale*1e-12;
        for (int i=0;i<count;++i) {
            const double magnitude=pivots[i];
            if (!std::isfinite(magnitude) || magnitude<=threshold) {
                const int index=free[i]; Failure failure("singular-system","Reduced stiffness is not positive definite above the registered pivot threshold",{{"kind","node"},{"id",nodes[index/6]["id"]}},"restraints");
                failure.diagnostic["dof"]=dofOrder[index%6]; failure.diagnostic["evidence"]={{"pivotMagnitude",std::isfinite(magnitude) ? std::abs(magnitude) : 0},{"threshold",threshold},{"matrixScale",matrixScale},{"globalDofIndex",index}}; throw failure;
            }
        }
        if (factorization.info()!=Eigen::Success) throw Failure("native-computation-error","Sparse factorization failed");
        const Vector solved=factorization.solve(rhs);
        if (factorization.info()!=Eigen::Success || !solved.allFinite()) throw Failure("native-computation-error","Sparse solve failed");
        const Vector residual=reduced*solved-rhs;
        const double denominator=matrixScale*solved.lpNorm<Eigen::Infinity>()+rhs.lpNorm<Eigen::Infinity>();
        if (residual.lpNorm<Eigen::Infinity>()>std::max(1e-9,denominator*1e-10)) throw Failure("native-computation-error","Sparse solve residual exceeds registered tolerance");
        for (int i=0;i<count;++i) displacement[free[i]]=solved[i];
    }
    phase("recovery"); const Vector reaction=global*displacement-force;
    if (!reaction.allFinite()) throw Failure("native-computation-error","Nonfinite reactions");
    Json nodeResults=Json::array(), dofs=Json::array(), memberResults=Json::array(), contributions=Json::array();
    for (size_t i=0;i<nodes.size();++i) {
        for (int d=0;d<6;++d) dofs.push_back({{"nodeId",nodes[i]["id"]},{"dof",dofOrder[d]},{"globalIndex",i*6+d},{"restrained",static_cast<bool>(restrained[i*6+d])}});
        nodeResults.push_back({{"nodeId",nodes[i]["id"]},{"displacement",json3(displacement.segment<3>(i*6))},{"rotation",json3(displacement.segment<3>(i*6+3))},{"reaction",json3(reaction.segment<3>(i*6))},{"reactionMoment",json3(reaction.segment<3>(i*6+3))}});
    }
    for (size_t i=0;i<elements.size();++i) {
        const auto& e=elements[i]; Vector u(12); for (int d=0;d<12;++d) u[d]=displacement[e.indices[d]];
        const Vector localU=e.recovery*e.transform*u+releaseOffsets[i];
        Vector ends=e.original*localU-originalEquivalent[i];
        for (int index:e.released) {
            check(std::abs(ends[index])<=std::max(1e-9,ends.cwiseAbs().maxCoeff()*1e-10),"native-computation-error","Released end moment residual exceeds tolerance",{{"kind","member"},{"id",e.member["id"]}},"endReleases");
            ends[index]=0;
        } const Vec3 q=loads.intensity[i];
        if (!localU.allFinite() || !ends.allFinite()) throw Failure("native-computation-error","Nonfinite member recovery",{{"kind","member"},{"id",e.member["id"]}},"localEndForces");
        Json responses=Json::array();
        for (int station=0;station<=16;++station) {
            const double t=station/16.0, x=e.length*t;
            const double h0=1-3*t*t+2*t*t*t, h1=e.length*(t-2*t*t+t*t*t), h2=3*t*t-2*t*t*t, h3=e.length*(-t*t+t*t*t);
            Vec3 sample(localU[0]*(1-t)+localU[6]*t,h0*localU[1]+h1*localU[5]+h2*localU[7]+h3*localU[11],h0*localU[2]-h1*localU[4]+h2*localU[8]-h3*localU[10]);
            if (staticSolver.at("implementation")=="framemind-native/3") {
                // Exact particular solutions with zero value/slope at the element ends.
                const double bubble=x*x*(e.length-x)*(e.length-x)/24;
                sample.x()+=q.x()*x*(e.length-x)/(2*e.original(0,0)*e.length);
                sample.y()+=q.y()*bubble/(e.original(5,5)*e.length/4);
                sample.z()+=q.z()*bubble/(e.original(4,4)*e.length/4);
            }
            Vector actions=-ends.head(6); actions[0]-=q.x()*x; actions[1]-=q.y()*x; actions[2]-=q.z()*x; actions[4]-=ends[2]*x+q.z()*x*x/2; actions[5]+=ends[1]*x+q.y()*x*x/2;
            const Vec3 globalSample=e.x*sample.x()+e.y*sample.y()+e.z*sample.z();
            if (!actions.allFinite() || !sample.allFinite() || !globalSample.allFinite()) throw Failure("native-computation-error","Nonfinite station recovery");
            responses.push_back({{"position",x},{"forces",jsonVector(actions)},{"localDisplacement",json3(sample)},{"globalDisplacement",json3(globalSample)}});
        }
        memberResults.push_back({{"memberId",e.member["id"]},{"length",e.length},{"localAxes",{{"x",json3(e.x)},{"y",json3(e.y)},{"z",json3(e.z)}}},{"localEndForces",{{"start",jsonVector(ends.head(6))},{"end",jsonVector(ends.tail(6))}}},{"nativeResponses",responses}});
        if (!e.released.empty()) memberResults.back()["nativeReleaseRecovery"]={
            {"originalLocalStiffness",jsonMatrix(e.original)},{"localStiffness",jsonMatrix(e.local)},
            {"transformation",jsonMatrix(e.transform)},{"recoveryTransformation",jsonMatrix(e.recovery)},
            {"localDisplacement",jsonVector(localU)},{"originalEquivalentLocalForces",jsonVector(originalEquivalent[i])},
            {"equivalentLocalForces",jsonVector(equivalentLocal[i])},{"equivalentGlobalForces",jsonVector(equivalentGlobal[i])},
            {"globalStiffness",jsonMatrix(e.global)}};
        Json elementDofs=Json::array(); for (int index:e.indices) elementDofs.push_back(dofs[index]);
        contributions.push_back({{"memberId",e.member["id"]},{"dofs",elementDofs},{"globalDofIndices",e.indices},{"globalStiffness",jsonMatrix(e.global)},{"equivalentGlobalForces",jsonVector(equivalentGlobal[i])}});
    }
    Json process={{"solver",staticSolver},{"dofOrder",dofOrder},{"dofs",dofs},{"loadVector",jsonVector(force)},{"freeDofs",free},{"constrainedDofs",constrained},
        {"matrixLimit",72},{"assembledStiffness",size<=72 ? jsonMatrix(Matrix(global)) : Json(nullptr)},{"reducedStiffness",count<=72 ? jsonMatrix(Matrix(reduced)) : Json(nullptr)},{"members",contributions}};
    if (!releaseGaugeDofs.empty()) { process["releaseGaugeDofs"]=releaseGaugeDofs; process["releaseNullRotations"]=releaseNullRotations; }
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},
        {"origin",origin},{"sourceId",source},{"dependencies",dependencies},{"solver",staticSolver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},{"nodes",nodeResults},{"members",memberResults},{"process",process},{"service",service}};
}
