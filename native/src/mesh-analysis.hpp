// Dyadic internal meshes reuse the verified /3 static element and load formulation.
static bool meshNumbersMatch(const Json& a, const Json& b) {
    if (a.is_number() && b.is_number()) return std::abs(number(a)-number(b))<=1e-12*std::max(1.0,std::abs(number(b)));
    if (a.type()!=b.type() || a.size()!=b.size()) return false;
    if (a.is_array()) { for (size_t i=0;i<a.size();++i) if (!meshNumbersMatch(a[i],b[i])) return false; return true; }
    if (a.is_object()) { for (auto i=b.begin();i!=b.end();++i) if (!a.contains(i.key()) || !meshNumbersMatch(a.at(i.key()),i.value())) return false; return true; }
    return a==b;
}

static Json meshLevel(const Json& input, int divisions) {
    Json nodes=Json::array(), elements=Json::array(); std::map<std::string,Vec3> positions;
    std::set<std::string> identities;
    for (const auto& n:input.at("nodes")) { const auto key=id(n.at("id")); positions[key]=vector3(n.at("position"),nullptr,"position"); identities.insert(key); }
    for (const auto& m:input.at("members")) check(identities.insert(id(m.at("id"))).second,"invalid-identity","Duplicate engineering member identity",{{"kind","member"},{"id",m["id"]}},"id");
    auto reserve=[&](const std::string& key) { require(identities.insert(key).second,"Internal mesh identity conflicts with engineering object",nullptr,"meshPlan"); return key; };
    for (size_t index=0;index<input.at("members").size();++index) {
        const auto& m=input.at("members")[index]; const auto start=id(m.at("startNodeId")), end=id(m.at("endNodeId"));
        require(positions.count(start) && positions.count(end),"Missing engineering mesh endpoint",{{"kind","member"},{"id",m["id"]}},"startNodeId");
        const double length=(positions.at(end)-positions.at(start)).norm(); require(length>1e-12,"Invalid engineering mesh length",{{"kind","member"},{"id",m["id"]}},"endNodeId");
        std::vector<std::string> endpoints={start};
        for (int i=1;i<divisions;++i) {
            const auto key=reserve("__mesh_"+std::to_string(divisions)+"_n_"+std::to_string(index)+"_"+std::to_string(i)); endpoints.push_back(key);
            nodes.push_back({{"nodeId",key},{"memberId",m["id"]},{"position",length*i/divisions},{"fraction",double(i)/divisions}});
        }
        endpoints.push_back(end);
        for (int i=0;i<divisions;++i) elements.push_back({{"elementId",reserve("__mesh_"+std::to_string(divisions)+"_e_"+std::to_string(index)+"_"+std::to_string(i))},
            {"memberId",m["id"]},{"startNodeId",endpoints[i]},{"endNodeId",endpoints[i+1]},{"start",length*i/divisions},{"end",length*(i+1)/divisions}});
    }
    return {{"divisions",divisions},{"nodes",nodes},{"elements",elements}};
}

static Json meshFrames(const Json& input) {
    Json frames=Json::object(); std::map<std::string,Vec3> positions;
    for (const auto& n:input.at("nodes")) positions[id(n["id"])]=vector3(n["position"],nullptr,"position");
    for (const auto& m:input.at("members")) {
        const Vec3 delta=positions.at(id(m["endNodeId"]))-positions.at(id(m["startNodeId"])); const double length=delta.norm();
        const Vec3 x=delta/length, ref=std::abs(x.z())<0.9-1e-12 ? Vec3(0,0,1) : Vec3(0,1,0), baseY=ref.cross(x).normalized(), baseZ=x.cross(baseY);
        const double angle=staticParameter(m,"member","rotationDegrees",false)*std::acos(-1.0)/180;
        frames[id(m["id"]) ]={{"length",length},{"localX",json3(x)},{"localY",json3(baseY*std::cos(angle)+baseZ*std::sin(angle))},{"localZ",json3(-baseY*std::sin(angle)+baseZ*std::cos(angle))},{"referenceAxis",std::abs(x.z())<0.9-1e-12 ? "global-z" : "global-y"}};
    }
    return frames;
}

static Json meshInput(const Json& input, const Json& level) {
    Json result=input; result.erase("meshPlan"); result["solver"]=legacyStaticSolver; result["solver"]["implementation"]="framemind-native/3";
    std::map<std::string,Json> members, nodes; for (const auto& m:input.at("members")) members[id(m["id"])]=m; for (const auto& n:input.at("nodes")) nodes[id(n["id"])]=n;
    for (const auto& entry:level.at("nodes")) {
        const auto& m=members.at(id(entry["memberId"])); const Vec3 a=vector3(nodes.at(id(m["startNodeId"]))["position"],nullptr,"position"), b=vector3(nodes.at(id(m["endNodeId"]))["position"],nullptr,"position");
        result["nodes"].push_back({{"id",entry["nodeId"]},{"label",entry["nodeId"]},{"position",json3(a+(b-a)*number(entry["fraction"]))}});
    }
    result["members"]=Json::array(); result["calculationFrames"]=Json::object(); const Json rigid={{"my",false},{"mz",false}};
    for (const auto& e:level.at("elements")) {
        Json m=members.at(id(e["memberId"])); const auto original=m;
        auto frame=input.at("meshPlan").at("frames").at(id(m["id"])); frame["length"]=number(e["end"])-number(e["start"]);
        result["calculationFrames"][id(e["elementId"])]=frame;
        m["id"]=e["elementId"]; m["label"]=e["elementId"]; m["startNodeId"]=e["startNodeId"]; m["endNodeId"]=e["endNodeId"];
        if (original.contains("endReleases")) {
            m["endReleases"]["start"]=e["startNodeId"]==original["startNodeId"] ? original["endReleases"]["start"] : rigid;
            m["endReleases"]["end"]=e["endNodeId"]==original["endNodeId"] ? original["endReleases"]["end"] : rigid;
        }
        result["members"].push_back(m);
    }
    auto loads=[&](const Json& originals) {
        Json output=Json::array();
        for (size_t index=0;index<originals.size();++index) { check(members.count(id(originals[index].at("memberId")))!=0,"invalid-reference","Missing engineering loaded member",{{"kind","uniform-load"},{"id",originals[index]["id"]}},"memberId"); int i=0; for (const auto& e:level.at("elements")) if (e["memberId"]==originals[index]["memberId"]) {
            Json q=originals[index]; q["id"]="__mesh_"+std::to_string(level.at("divisions").get<int>())+"_q_"+std::to_string(index)+"_"+std::to_string(i);
            q["label"]="__mesh_q_"+std::to_string(index)+"_"+std::to_string(i++); q["memberId"]=e["elementId"]; output.push_back(q);
        } }
        return output;
    };
    result["uniformLoads"]=loads(input.at("uniformLoads"));
    if (input.contains("combination")) {
        for (auto& c:result["combination"]["cases"]) c["uniformLoads"]=loads(c.at("uniformLoads"));
        for (size_t i=0;i<result["uniformLoads"].size();++i) { std::ostringstream key; key<<"uniform_load_"<<std::setw(4)<<std::setfill('0')<<i+1; result["uniformLoads"][i]["id"]=key.str(); result["uniformLoads"][i]["label"]="Q"+std::to_string(i+1); }
    }
    return result;
}

static Json meshMappedResult(const Json& result, const Json& input, const Json& level) {
    Json mapped=result; mapped["input"]=input; mapped.erase("process"); mapped["members"]=Json::array(); mapped["nodes"]=Json::array();
    for (size_t i=0;i<input.at("nodes").size();++i) mapped["nodes"].push_back(result.at("nodes")[i]);
    size_t offset=0; const int divisions=level.at("divisions").get<int>();
    for (const auto& m:input.at("members")) {
        const auto& first=result.at("members")[offset]; const auto& last=result.at("members")[offset+divisions-1];
        Json member=first; member["memberId"]=m["id"]; member.erase("nativeReleaseRecovery");
        const double length=number(level.at("elements")[offset+divisions-1]["end"]); member["length"]=length; member["localEndForces"]["end"]=last.at("localEndForces").at("end");
        Json samples=Json::array();
        for (int station=0;station<=16;++station) {
            const int scaled=station*divisions, element=std::min(divisions-1,scaled/16), local=scaled-element*16;
            Json sample=result.at("members")[offset+element].at("nativeResponses")[local]; sample["position"]=length*station/16; samples.push_back(sample);
        }
        member["nativeResponses"]=samples; mapped["members"].push_back(member); offset+=divisions;
    }
    return mapped;
}

static Json meshErrors(const Json& previous, const Json& current, const Json& policy) {
    double displacement=0,reaction=0,force=0; const double relative=number(policy.at("relativeTolerance"));
    auto compare=[&](double a,double b,double absolute,double& error) { error=std::max(error,std::abs(a-b)/(absolute+relative*std::max(std::abs(a),std::abs(b)))); };
    auto vector=[&](const Json& a,const Json& b,double absolute,double& error) { for (const auto& axis:{"x","y","z"}) compare(number(a.at(axis)),number(b.at(axis)),absolute,error); };
    for (size_t i=0;i<current.at("nodes").size();++i) {
        for (const auto& key:{"displacement","rotation"}) vector(previous["nodes"][i][key],current["nodes"][i][key],number(policy["displacementTolerance"]),displacement);
        for (const auto& key:{"reaction","reactionMoment"}) vector(previous["nodes"][i][key],current["nodes"][i][key],number(policy["forceTolerance"]),reaction);
    }
    for (size_t i=0;i<current.at("members").size();++i) for (int station=0;station<=16;++station) {
        const auto& a=previous["members"][i]["nativeResponses"][station]; const auto& b=current["members"][i]["nativeResponses"][station];
        vector(a["globalDisplacement"],b["globalDisplacement"],number(policy["displacementTolerance"]),displacement);
        for (int component=0;component<6;++component) compare(number(a["forces"][component]),number(b["forces"][component]),number(policy["forceTolerance"]),force);
    }
    return {{"displacement",displacement},{"reaction",reaction},{"sectionForce",force}};
}

static Json calculateMeshStatic(const Json& request, Json& stages, std::string& stage) {
    const auto& input=request.at("input"); Json meshSolver=legacyStaticSolver; meshSolver["implementation"]="framemind-native/4";
    require(input.at("solver")==meshSolver,"Unsupported mesh solver"); const auto& plan=input.at("meshPlan"); const auto& policy=plan.at("policy");
    require(validMeshPolicy(policy),"Invalid mesh policy",nullptr,"meshPlan");
    const int maxDivisions=static_cast<int>(number(policy.at("maxDivisions"))), maxEquations=static_cast<int>(number(policy.at("maxEquations")));
    require(plan.at("levels").is_array(),"Missing frozen mesh mappings",nullptr,"meshPlan");
    int count=0; for (int divisions=1;divisions<=maxDivisions;divisions*=2) { require(count<static_cast<int>(plan["levels"].size()) && meshNumbersMatch(plan["levels"][count],meshLevel(input,divisions)),"Frozen mesh mapping mismatch",nullptr,"meshPlan"); ++count; }
    require(count==static_cast<int>(plan["levels"].size()),"Unexpected mesh levels",nullptr,"meshPlan");
    require(meshNumbersMatch(plan.at("frames"),meshFrames(input)),"Frozen engineering frames mismatch",nullptr,"meshPlan");
    Json runs=Json::array(), previous, mapped, finalResult; std::string status="budget-exhausted",reason="max-divisions"; int selected=0;
    for (const auto& level:plan.at("levels")) {
        Json calculation=meshInput(input,level);
        std::set<std::pair<std::string,int>> constrained; for (const auto& support:input.at("supports")) for (int d=0;d<6;++d) if (support.at("restraints")[d]==true) constrained.insert({id(support["nodeId"]),d});
        // Conservative pre-allocation bound includes disconnected rotation coordinates.
        const size_t equations=calculation.at("nodes").size()*6-constrained.size();
        if (equations>static_cast<size_t>(maxEquations)) { reason="equation-budget"; break; }
        Json packet=request; packet["input"]=calculation; Json runStages=Json::array();
        try { finalResult=calculateStatic(packet,runStages,stage,runs.empty(),true); }
        catch (Failure& failure) {
            if (failure.diagnostic.contains("target")) {
                auto& target=failure.diagnostic["target"]; const auto key=target.value("id",std::string());
                for (const auto& n:level["nodes"]) if (n["nodeId"]==key) { target={{"kind","member"},{"id",n["memberId"]}}; failure.diagnostic["position"]=n["position"]; }
                for (const auto& e:level["elements"]) if (e["elementId"]==key) { target={{"kind","member"},{"id",e["memberId"]}}; failure.diagnostic["position"]=e["start"]; }
            }
            throw;
        }
        if (runs.empty()) stages=runStages;
        mapped=meshMappedResult(finalResult,input,level); Json run={{"divisions",level["divisions"]},{"result",finalResult}}; selected=level["divisions"].get<int>();
        if (!previous.is_null()) { run["error"]=meshErrors(previous,mapped,policy); bool converged=true; for (auto e=run["error"].begin();e!=run["error"].end();++e) converged=converged && number(e.value())<=1; if (converged) { status="converged"; reason="tolerance"; } }
        runs.push_back(run); previous=mapped; if (status=="converged") break;
    }
    if (runs.empty()) throw Failure("mesh-budget-exhausted","Equation budget prevents even the initial mesh",nullptr,"meshPlan");
    const auto& process=finalResult.at("process");
    mapped["service"]["solver"]=meshSolver; mapped["service"]["stages"]=stages;
    mapped["discretization"]={{"status",status},{"reason",reason},{"selectedDivisions",selected},{"runs",runs},
        {"counts",{{"engineeringNodes",input.at("nodes").size()},{"engineeringMembers",input.at("members").size()},
        {"calculationNodes",finalResult["nodes"].size()},{"calculationElements",finalResult["members"].size()},{"totalDofs",process["dofs"].size()},
        {"constrainedDofs",process["constrainedDofs"].size()},{"releaseGaugeDofs",process.value("releaseGaugeDofs",Json::array()).size()},{"equations",process["freeDofs"].size()}}}};
    return mapped;
}
