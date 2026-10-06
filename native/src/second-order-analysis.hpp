// Initial-stress, small-displacement elastic response, using the same axial
// Hermite slope energy as buckling. Prestress is frozen from this load's linear run.
static Json secondOrderPacket(const Json& request, const Json& level) {
    Json packet=request, input=request.at("input"); input.erase("analysisCase");
    packet["input"]=meshInput(input,level);
    packet["sourceId"]=input.contains("combination") ? input["combination"]["definition"]["id"] : input["loadCase"]["id"];
    return packet;
}

static Vector secondOrderEquivalent(const StaticElement& e, const Json& linearMember, const Vector& linearLocal) {
    Vector ends(12); for (int i=0;i<6;++i) { ends[i]=number(linearMember["localEndForces"]["start"][i]); ends[i+6]=number(linearMember["localEndForces"]["end"][i]); }
    return e.original*linearLocal-ends;
}

static Json secondOrderLevel(const Json& request, const Json& level, std::string& stage, const std::function<void(const std::string&)>& phase) {
    const Json packet=secondOrderPacket(request,level); Json ignored=Json::array();
    ModalAssembly assembly; assembly.onPhase=phase; calculateStatic(packet,ignored,stage,false,true,&assembly);
    ignored=Json::array(); Json linear=calculateStatic(packet,ignored,stage,false,true);
    const auto& settings=request["input"]["analysisCase"]["settings"]["secondOrder"];
    const int nodal=static_cast<int>(assembly.free.size()); int count=nodal;
    for (const auto& e:assembly.elements) count+=static_cast<int>(e.released.size());
    if (!count || count>number(settings["maxEquations"])) throw Failure("second-order-budget-exhausted","No second-order coordinates within equation budget",nullptr,"secondOrder");
    std::vector<int> reduced(assembly.size,-1); for (int i=0;i<nodal;++i) reduced[assembly.free[i]]=i;
    Matrix k=Matrix::Zero(count,count), g=k; Vector f=Vector::Zero(count);
    Vector linearU(assembly.size); for (int i=0;i<assembly.size;++i) linearU[i]=number(linear["nodes"][i/6][i%6<3 ? "displacement" : "rotation"][std::string(1,"xyz"[i%3])]);
    std::vector<Matrix> maps; std::vector<Vector> equivalents; std::vector<std::pair<double,double>> axial;
    int extra=nodal; Json coordinates=Json::array();
    for (int index:assembly.free) coordinates.push_back({{"kind","node"},{"id",packet["input"]["nodes"][index/6]["id"]},{"dof",dofOrder[index%6]}});
    // Start with actual nodal loads, then add original element equivalents through
    // the independent release-coordinate map (not condensed release loads).
    Vector nodalLoads=Vector::Zero(assembly.size);
    for (const auto& load:packet["input"]["nodalLoads"]) for (size_t n=0;n<packet["input"]["nodes"].size();++n) if (packet["input"]["nodes"][n]["id"]==load["nodeId"]) {
        nodalLoads.segment<3>(n*6)+=vector3(load["force"],nullptr,"force"); nodalLoads.segment<3>(n*6+3)+=vector3(load["moment"],nullptr,"moment");
    }
    for (int i=0;i<nodal;++i) f[i]=nodalLoads[assembly.free[i]];
    for (size_t i=0;i<assembly.elements.size();++i) {
        const auto& e=assembly.elements[i]; Matrix b=Matrix::Zero(12,count);
        for (int r=0;r<12;++r) for (int c=0;c<12;++c) if (reduced[e.indices[c]]>=0) b(r,reduced[e.indices[c]])=e.transform(r,c);
        for (int r:e.released) { b.row(r).setZero(); b(r,extra++)=1; coordinates.push_back({{"kind","release"},{"id",e.member["id"]},{"dof",std::string(r<6 ? "start." : "end.")+(r%6==4 ? "my" : "mz")}}); }
        Vector v(12); for (int r=0;r<12;++r) v[r]=linearU[e.indices[r]]; v=e.transform*v;
        if (!e.released.empty()) for (int r=0;r<12;++r) v[r]=number(linear["members"][i]["nativeReleaseRecovery"]["localDisplacement"][r]);
        const Vector eq=secondOrderEquivalent(e,linear["members"][i],v);
        const auto& ends=linear["members"][i]["localEndForces"];
        const double ns=-number(ends["start"][0]), ne=number(ends["end"][0]);
        k.noalias()+=b.transpose()*e.original*b; g.noalias()+=b.transpose()*initialStressGeometric(e,ns,ne)*b; f.noalias()+=b.transpose()*eq;
        maps.push_back(std::move(b)); equivalents.push_back(eq); axial.push_back({ns,ne});
    }
    if (!k.allFinite() || !g.allFinite() || !f.allFinite()) throw Failure("second-order-nonfinite","Nonfinite second-order assembly",nullptr,"secondOrder");
    Vector scale(count); for (int i=0;i<count;++i) { if (!(k(i,i)>0)) throw Failure("singular-system","Missing elastic stiffness",nullptr,"restraints"); scale[i]=1/std::sqrt(k(i,i)); }
    const Matrix sk=scale.asDiagonal()*k*scale.asDiagonal(), sg=scale.asDiagonal()*g*scale.asDiagonal();
    const Vector sf=scale.asDiagonal()*f; Vector z=Vector::Zero(count); Json iterations=Json::array();
    stage="solve"; if (phase) phase(stage);
    const int steps=static_cast<int>(number(settings["loadSteps"])), maximum=static_cast<int>(number(settings["maxIterations"]));
    for (int step=1;step<=steps;++step) {
        const double alpha=double(step)/steps; const Matrix tangent=sk+alpha*sg; const Vector rhs=alpha*sf;
        Eigen::LLT<Matrix> factor(tangent);
        if (!tangent.allFinite() || factor.info()!=Eigen::Success || factor.matrixL().toDenseMatrix().diagonal().array().square().minCoeff()<=1e-12)
            throw Failure("second-order-unstable-tangent","Second-order tangent is not positive definite; reduce loads and check restraints/releases",nullptr,"secondOrder");
        bool converged=false;
        for (int iteration=1;iteration<=maximum;++iteration) {
            const double denominator=std::max(1.0,rhs.norm()); const Vector before=rhs-tangent*z;
            const Vector correction=factor.solve(before); z+=correction;
            const double residual=(rhs-tangent*z).norm()/denominator, increment=correction.norm()/std::max(1e-12,z.norm());
            if (!z.allFinite() || !correction.allFinite() || !std::isfinite(residual) || !std::isfinite(increment)) throw Failure("second-order-nonfinite","Nonfinite second-order correction",nullptr,"secondOrder");
            iterations.push_back({{"step",step},{"factor",alpha},{"iteration",iteration},{"residualBefore",before.norm()/denominator},{"residual",residual},{"increment",increment},{"displacement",jsonVector(scale.asDiagonal()*z)},{"correction",jsonVector(scale.asDiagonal()*correction)}});
            if (residual<=number(settings["residualTolerance"]) && increment<=number(settings["incrementTolerance"])) { converged=true; break; }
        }
        if (!converged) { Failure failure("second-order-not-converged","Second-order iteration limit reached; no converged result was published",nullptr,"maxIterations"); failure.diagnostic["iterations"]=iterations; throw failure; }
    }
    const Vector q=scale.asDiagonal()*z; Vector globalU=Vector::Zero(assembly.size), reaction=-nodalLoads;
    for (int i=0;i<nodal;++i) globalU[assembly.free[i]]=q[i];
    Json members=Json::array(), localDisplacements=Json::array();
    for (size_t i=0;i<assembly.elements.size();++i) {
        const auto& e=assembly.elements[i]; const Vector v=maps[i]*q;
        const auto [ns,ne]=axial[i]; const Matrix geo=initialStressGeometric(e,ns,ne);
        const Vector ends=(e.original+geo)*v-equivalents[i]; const Vector globalEnds=e.transform.transpose()*ends;
        for (int r=0;r<12;++r) reaction[e.indices[r]]+=globalEnds[r];
        localDisplacements.push_back(jsonVector(v)); Json samples=Json::array();
        const Vec3 intensity(equivalents[i][0]*2/e.length,equivalents[i][1]*2/e.length,equivalents[i][2]*2/e.length);
        auto slopeAt=[&](double t) { const auto s=initialStressSlope(e.length,t);
            return Vec3(0,s[0]*v[1]+s[1]*v[5]+s[2]*v[7]+s[3]*v[11],s[0]*v[2]-s[1]*v[4]+s[2]*v[8]-s[3]*v[10]); };
        const Vec3 slopeStart=slopeAt(0),slopeEnd=slopeAt(1),slopeControl=2*slopeAt(.5)-(slopeStart+slopeEnd)/2;
        const double axialMean=(v[6]-v[0])/e.length,axialOffset=intensity.x()/(2*e.original(0,0));
        // The quadratic slope curve lies inside its Bernstein control-point hull.
        // This bounds the entire element, including positions between saved stations.
        if (std::max({slopeStart.norm(),slopeControl.norm(),slopeEnd.norm()})>.05 || std::max(std::abs(axialMean+axialOffset),std::abs(axialMean-axialOffset))>.01)
            throw Failure("second-order-scope-exceeded","Small-displacement slope/axial-strain boundary exceeded; reduce loads",{{"kind","member"},{"id",e.member["id"]}},"secondOrder");
        for (int station=0;station<=16;++station) {
            const double t=double(station)/16, x=e.length*t, l=e.length;
            const double h0=1-3*t*t+2*t*t*t,h1=l*(t-2*t*t+t*t*t),h2=3*t*t-2*t*t*t,h3=l*(-t*t+t*t*t);
            const Vec3 local((1-t)*v[0]+t*v[6]+intensity.x()*x*(l-x)/(2*e.original(0,0)*l),h0*v[1]+h1*v[5]+h2*v[7]+h3*v[11],h0*v[2]-h1*v[4]+h2*v[8]-h3*v[10]);
            // Integrate N(s) w'(s) exactly on [0,x]. N is linear and slope quadratic.
            const double points[2]={.5-std::sqrt(3.0)/6,.5+std::sqrt(3.0)/6}; double iy=0,iz=0;
            for (double point:points) { const double r=t*point, n=ns*(1-r)+ne*r; const auto slope=slopeAt(r);
                iy+=x*.5*n*slope.y(); iz+=x*.5*n*slope.z(); }
            Vector forces=-ends.head(6); forces[0]-=intensity.x()*x; forces[1]-=intensity.y()*x; forces[2]-=intensity.z()*x;
            forces[4]+=-ends[2]*x-intensity.z()*x*x/2-iz; forces[5]+=ends[1]*x+intensity.y()*x*x/2+iy;
            samples.push_back({{"position",x},{"forces",jsonVector(forces)},{"localDisplacement",json3(local)},{"globalDisplacement",json3(e.x*local.x()+e.y*local.y()+e.z*local.z())}});
        }
        members.push_back({{"memberId",e.member["id"]},{"length",e.length},{"localAxes",{{"x",json3(e.x)},{"y",json3(e.y)},{"z",json3(e.z)}}},{"localEndForces",{{"start",jsonVector(ends.head(6))},{"end",jsonVector(ends.tail(6))}}},{"nativeResponses",samples}});
    }
    if (!reaction.allFinite()) throw Failure("second-order-nonfinite","Nonfinite second-order reactions",nullptr,"secondOrder");
    Json nodes=Json::array(); for (size_t i=0;i<packet["input"]["nodes"].size();++i) nodes.push_back({{"nodeId",packet["input"]["nodes"][i]["id"]},{"displacement",json3(globalU.segment<3>(i*6))},{"rotation",json3(globalU.segment<3>(i*6+3))},{"reaction",json3(reaction.segment<3>(i*6))},{"reactionMoment",json3(reaction.segment<3>(i*6+3))}});
    return {{"coordinates",coordinates},{"releaseNullRotations",assembly.releaseNullRotations},{"vector",jsonVector(q)},{"force",jsonVector(f)},{"matrixLimit",144},{"stiffness",count<=144 ? jsonMatrix(k) : Json(nullptr)},{"geometric",count<=144 ? jsonMatrix(g) : Json(nullptr)},
        {"localDisplacements",localDisplacements},{"iterations",iterations},{"linearRun",linear},{"nodes",nodes},{"members",members}};
}

static Json calculateSecondOrder(const Json& request, Json& stages, std::string& stage) {
    auto phase=[&](const std::string& name) { stage=name; Json record={{"stage",name},{"startedAt",now()}}; stages.push_back(record); emit({{"kind","phase"},{"requestId",request.at("requestId")},{"record",record}}); };
    phase("model-check"); const auto& input=request.at("input"), definition=input.at("analysisCase"), s=definition.at("settings").at("secondOrder");
    Json secondOrderSolver=legacyStaticSolver; secondOrderSolver["implementation"]="framemind-native/7";
    require(input.at("solver")==secondOrderSolver && definition.at("method")=="second-order" && definition.at("settings").size()==2 && definition["settings"]["solver"]=="native-second-order","Unsupported second-order contract");
    Json identity=input; identity["analysisCase"]["method"]="static"; identity["analysisCase"]["settings"]={{"solver","native-static"}};
    analysisCaseSource(identity,input.contains("combination") ? input["combination"]["definition"]["id"] : input["loadCase"]["id"]);
    require(s.is_object() && s.size()==7,"Invalid second-order settings");
    const double steps=number(s.at("loadSteps")),iterations=number(s.at("maxIterations")),budget=number(s.at("maxEquations")),div=number(s.at("maxDivisions")),tol=number(s.at("meshTolerance"));
    require(steps>=1 && steps<=100 && std::floor(steps)==steps && iterations>=1 && iterations<=100 && std::floor(iterations)==iterations && budget>=1 && budget<=1200 && std::floor(budget)==budget && (div==1 || div==2 || div==4 || div==8 || div==16) && tol>0 && tol<=.01,"Invalid second-order controls");
    for (const auto& key:{"residualTolerance","incrementTolerance"}) require(number(s.at(key))>0 && number(s.at(key))<=1e-6,"Invalid second-order tolerance");
    const auto& plan=input.at("meshPlan"); const Json policy={{"maxDivisions",div},{"maxEquations",budget},{"relativeTolerance",tol},{"displacementTolerance",1e-9},{"forceTolerance",1e-6}};
    require(meshNumbersMatch(plan.at("policy"),policy) && meshNumbersMatch(plan.at("frames"),meshFrames(input)),"Second-order mesh policy mismatch");
    int levels=0; for (int d=1;d<=div;d*=2) { require(levels<static_cast<int>(plan["levels"].size()) && meshNumbersMatch(plan["levels"][levels],meshLevel(input,d)),"Second-order mesh mapping mismatch"); ++levels; }
    require(levels==static_cast<int>(plan["levels"].size()),"Unexpected second-order mesh levels");
    require(request.at("sourceId")==definition.at("id"),"Second-order source mismatch");
    Json runs=Json::array(),previous,mapped,selected; bool converged=false;
    for (const auto& level:plan["levels"]) {
        size_t restraints=0,releases=0; std::set<std::pair<std::string,int>> fixed;
        for (const auto& support:input["supports"]) for (int i=0;i<6;++i) if (support["restraints"][i]==true) fixed.insert({id(support["nodeId"]),i}); restraints=fixed.size();
        for (const auto& m:input["members"]) if (m.contains("endReleases")) for (const auto& end:{"start","end"}) for (const auto& component:{"my","mz"}) if (m["endReleases"][end][component]==true) ++releases;
        if ((input["nodes"].size()+level["nodes"].size())*6-restraints+releases>budget) break;
        Json calculation; try { calculation=secondOrderLevel(request,level,stage,runs.empty() ? std::function<void(const std::string&)>(phase) : std::function<void(const std::string&)>()); }
        catch (Failure& failure) { remapMeshFailure(failure,level); throw; }
        mapped=meshMappedResult(calculation,input,level); selected=level;
        Json run={{"divisions",level["divisions"]},{"calculation",calculation}};
        if (!previous.is_null()) { run["error"]=meshErrors(previous,mapped,policy); converged=true; for (auto e=run["error"].begin();e!=run["error"].end();++e) converged=converged && number(e.value())<=1; }
        runs.push_back(run); previous=mapped; if (converged) break;
    }
    if (runs.empty()) throw Failure("second-order-budget-exhausted","Equation budget prevents the initial second-order mesh",nullptr,"maxEquations");
    if (!converged) { Failure failure("second-order-mesh-not-converged","Second-order response did not converge within mesh/equation budget; increase budget",nullptr,"maxDivisions");
        Json history=Json::array(); for (const auto& run:runs) { Json summary={{"divisions",run["divisions"]},{"iterations",run["calculation"]["iterations"]}}; if (run.contains("error")) summary["error"]=run["error"]; history.push_back(summary); }
        failure.diagnostic["convergence"]=history; throw failure; }
    phase("recovery");
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},
        {"origin",request["origin"]},{"sourceId",request["sourceId"]},{"dependencies",request["dependencies"]},{"solver",secondOrderSolver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},{"nodes",mapped["nodes"]},{"members",mapped["members"]},{"service",service},
        {"secondOrder",{{"method","initial-stress-small-displacement"},{"equation","(K+alpha*G[Nlinear])u=alpha*F"},{"status","converged"},{"selectedDivisions",selected["divisions"]},{"runs",runs}}}};
}
