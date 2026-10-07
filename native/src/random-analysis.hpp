#include <complex>

struct RandomMode { double frequency, omega, damping; std::vector<double> coefficients; };
struct RandomRun { int points; double variance, rms, curveDifference=0, varianceDifference=0, rmsDifference=0, peak=0; };

static Json randomStructuralIdentity(const Json& input) {
    Json nodes=Json::object(), members=Json::object(), materials=Json::object(), sections=Json::object(), supports=Json::object();
    for (const auto& n:input.at("nodes")) nodes[id(n["id"]) ]={{"position",n["position"]},{"mass",n.value("additionalMassKg",0.0)}};
    std::set<std::string> materialIds, sectionIds;
    for (auto m:input.at("members")) { materialIds.insert(id(m["materialId"])); sectionIds.insert(id(m["sectionId"])); m.erase("label"); m["additionalLineMassKgM"]=m.value("additionalLineMassKgM",0.0); members[id(m["id"])]=m; }
    for (const auto& m:input.at("materials")) if (materialIds.count(id(m["id"]))) materials[id(m["id"]) ]={{"E",m["elasticModulusGPa"]},{"nu",m["poissonRatio"]},{"density",m["densityKgM3"]}};
    for (const auto& s:input.at("sections")) if (sectionIds.count(id(s["id"]))) sections[id(s["id"]) ]={{"A",s["areaM2"]},{"Iy",s["secondMomentYM4"]},{"Iz",s["secondMomentZM4"]},{"J",s["torsionalConstantM4"]}};
    for (const auto& s:input.at("supports")) supports[id(s["id"])]=s;
    return {{"nodes",nodes},{"members",members},{"materials",materials},{"sections",sections},{"supports",supports},{"assumptions",input.at("assumptions")},{"dofOrder",input.at("dofOrder")}};
}
static double randomSpectrum(const Json& points, double frequency) {
    size_t low=0, high=points.size()-1;
    while (high-low>1) { const size_t mid=(low+high)/2; if (number(points[mid]["frequency"])<frequency) low=mid; else high=mid; }
    const double a=number(points[low]["frequency"]), b=number(points[high]["frequency"]), t=(frequency-a)/(b-a);
    return number(points[low]["density"])*(1-t)+number(points[high]["density"])*t;
}
static std::vector<double> randomDensities(const std::vector<RandomMode>& modes, const Json& spectra, const std::vector<double>& grid, size_t count) {
    std::vector<double> result; result.reserve(grid.size());
    for (double frequency:grid) {
        const double omega=2*std::acos(-1.0)*frequency; double total=0;
        for (size_t source=0;source<spectra.size();++source) {
            const double density=randomSpectrum(spectra[source].at("spectrum").at("points"),frequency);
            double real=0, imaginary=0;
            for (size_t i=0;i<count;++i) {
                const auto& m=modes[i]; const double re=m.omega*m.omega-omega*omega, im=2*m.damping*m.omega*omega, denominator=re*re+im*im;
                if (!(denominator>0) || !std::isfinite(denominator)) throw Failure("random-numeric-range","Random transfer denominator exceeds finite precision",nullptr,"random");
                real+=m.coefficients[source]*re/denominator; imaginary-=m.coefficients[source]*im/denominator;
            }
            const double value=(real*real+imaginary*imaginary)*density;
            if (!std::isfinite(value) || value<0 || (value==0 && density>0 && (real!=0 || imaginary!=0))) throw Failure("random-numeric-range","Random PSD overflows or nonzero density underflows",nullptr,"random");
            total+=value;
        }
        if (!std::isfinite(total)) throw Failure("random-numeric-range","Independent source PSD sum overflows",nullptr,"random");
        result.push_back(total);
    }
    return result;
}
// Exact EB shape integral on the actual frozen mesh, including release coordinates.
static Vec3 randomActionShape(const Json& modalInput, const Json& modal, const Json& level, size_t mode, const Json& action) {
    if (action.at("kind")=="node") {
        for (const auto& n:modal.at("modes")[mode].at("nodes")) if (n.at("nodeId")==action.at("nodeId")) return vector3(n.at("translation"),nullptr,"translation");
        throw Failure("random-missing-node","Random source node is missing",nullptr,"random");
    }
    std::map<std::string,double> values; const auto& problem=modal.at("eigenproblem");
    for (size_t i=0;i<problem.at("coordinates").size();++i) { const auto& c=problem.at("coordinates")[i]; values[id(c.at("kind"))+":"+id(c.at("id"))+":"+id(c.at("dof"))]=number(problem.at("vectors")[mode][i]); }
    const auto& frame=modalInput.at("meshPlan").at("frames").at(id(action.at("memberId")));
    const Vec3 axes[3]={vector3(frame.at("localX"),nullptr,"localX"),vector3(frame.at("localY"),nullptr,"localY"),vector3(frame.at("localZ"),nullptr,"localZ")};
    Vec3 integral=Vec3::Zero();
    for (const auto& e:level.at("elements")) if (e.at("memberId")==action.at("memberId")) {
        Vector global=Vector::Zero(12), local=global;
        for (int end=0;end<2;++end) for (int d=0;d<6;++d) global[end*6+d]=values["node:"+id(e.at(end ? "endNodeId" : "startNodeId"))+":"+id(dofOrder[d])];
        for (int i=0;i<12;++i) local[i]=axes[i%3].dot(global.segment<3>(i/3*3));
        for (const auto& entry:std::vector<std::pair<int,std::string>>{{4,"start.my"},{5,"start.mz"},{10,"end.my"},{11,"end.mz"}}) {
            const auto key="release:"+id(e.at("elementId"))+":"+entry.second; if (values.count(key)) local[entry.first]=values.at(key);
        }
        const double l=number(e.at("end"))-number(e.at("start"));
        integral+=axes[0]*(l/2*(local[0]+local[6]))+axes[1]*(l/2*(local[1]+local[7])+l*l/12*(local[5]-local[11]))+axes[2]*(l/2*(local[2]+local[8])-l*l/12*(local[4]-local[10]));
    }
    require(integral.allFinite(),"Random member shape integral exceeds finite precision",nullptr,"random");
    return integral;
}
static double randomVariance(const std::vector<double>& grid, const std::vector<double>& density) {
    double sum=0;
    for (size_t i=1;i<grid.size();++i) {
        const double part=(density[i-1]/2+density[i]/2)*(grid[i]-grid[i-1]);
        if (!std::isfinite(part) || (part==0 && (density[i-1]>0 || density[i]>0))) throw Failure("random-numeric-range","Random integral overflows or nonzero area underflows",nullptr,"integration");
        sum+=part;
    }
    if (!std::isfinite(sum)) throw Failure("random-numeric-range","Random variance overflows",nullptr,"integration");
    return sum;
}
static Json calculateRandom(const Json& request, Json& stages, std::string& stage) {
    auto phase=[&](const std::string& name) { stage=name; Json record={{"stage",name},{"startedAt",now()}}; stages.push_back(record); emit({{"kind","phase"},{"requestId",request.at("requestId")},{"record",record}}); };
    phase("model-check");
    const auto& input=request.at("input"); const auto& definition=input.at("analysisCase"); const auto& settings=definition.at("settings").at("random"); const auto& basis=input.at("randomBasis");
    const Json randomSolver={{"implementation","framemind-native/8"},{"algorithm","generalized-self-adjoint"},{"constraints","free-dof-elimination"},{"relativePivotTolerance",1e-12}};
    require(request.at("version")=="framemind-analysis/1" && input.at("solver")==randomSolver && definition.at("method")=="random" && definition.at("loadSourceId")=="random"
        && definition.at("settings").size()==2 && definition.at("settings").at("solver")=="native-random" && !definition.contains("damping") && !definition.contains("legacySourceId")
        && request.at("sourceId")==definition.at("id") && request.at("dependencies")==Json::array(),"Invalid random analysis contract");
    Json identity=input; identity["analysisCase"]["method"]="static"; identity["analysisCase"]["loadSourceId"]=input.at("loadCase").at("id"); identity["analysisCase"]["settings"]={{"solver","native-static"}};
    analysisCaseSource(identity,input.at("loadCase").at("id"));
    require(input.at("nodalLoads").empty() && input.at("uniformLoads").empty() && !input.at("selfWeight").at("enabled").get<bool>() && !input.contains("combination") && !input.contains("meshPlan"),"Random input does not accept static loads or static mesh settings");
    const bool distributed=settings.contains("sources");
    std::set<std::string> keys={"modalAnalysisId","response","bandHz","frequencyPoints","maxFrequencyPoints","maxRefinements","modeIncrement","relativeTolerance","absolutePsdTolerance","absoluteVarianceTolerance","absoluteRmsTolerance","integration"};
    if (distributed) { keys.insert("sources"); keys.insert("sourceRelationship"); } else { keys.insert("psdSpectrumId"); keys.insert("excitation"); }
    require(settings.is_object() && settings.size()==keys.size(),"Invalid random settings fields"); for (const auto& key:keys) require(settings.contains(key),"Missing random setting");
    Json sources;
    if (distributed) {
        require(settings.at("sourceRelationship")=="independent" && settings.at("sources").is_array() && !settings.at("sources").empty() && settings.at("sources").size()<=16,"Only explicitly independent random sources are supported");
        sources=settings.at("sources");
    } else {
        const auto& excitation=settings.at("excitation"); require(excitation.is_object() && excitation.size()==3,"Invalid legacy node force");
        Json action=excitation; action["kind"]="node";
        sources=Json::array({{{"sourceId","legacy-node-source"},{"psdSpectrumId",settings.at("psdSpectrumId")},{"actions",Json::array({action})}}});
    }
    std::set<std::string> sourceIds; size_t actionCount=0;
    for (const auto& source:sources) {
        const auto sourceId=id(source.at("sourceId"));
        require(source.is_object() && source.size()==3 && sourceIds.insert(sourceId).second && source.at("actions").is_array() && !source.at("actions").empty(),"Random source identity must be unique with explicit actions");
        actionCount+=source.at("actions").size(); require(actionCount<=128,"Random spatial action budget exceeded");
        for (const auto& action:source.at("actions")) {
            const bool node=action.at("kind")=="node"; const auto target=action.at(node ? "nodeId" : "memberId");
            require(action.is_object() && action.size()==4 && (node || action.at("kind")=="member-uniform") && action.at("direction").is_object() && action.at("direction").size()==3,"Only node and whole-member uniform global forces are supported");
            const auto direction=vector3(action.at("direction"),nullptr,"direction"); number(action.at(node ? "scale" : "scalePerM"));
            require(std::abs(direction.norm()-1)<=1e-10,"Random direction must be a global unit vector");
            bool exists=false; for (const auto& object:input.at(node ? "nodes" : "members")) exists|=object.at("id")==target;
            require(exists,"Random spatial target is missing");
        }
    }
    auto integer=[&](const std::string& key,int low,int high) { const double n=number(settings.at(key)); require(n>=low && n<=high && std::floor(n)==n,"Invalid random integer budget",nullptr,key); return static_cast<int>(n); };
    const int initialPoints=integer("frequencyPoints",3,10001), maxPoints=integer("maxFrequencyPoints",initialPoints,20001), refinements=integer("maxRefinements",1,12), increment=integer("modeIncrement",1,49);
    const double tolerance=number(settings.at("relativeTolerance")), psdTolerance=number(settings.at("absolutePsdTolerance")), varianceTolerance=number(settings.at("absoluteVarianceTolerance")), rmsTolerance=number(settings.at("absoluteRmsTolerance"));
    require(tolerance>0 && tolerance<=.01 && psdTolerance>0 && psdTolerance<=1e-12 && varianceTolerance>0 && varianceTolerance<=1e-12 && rmsTolerance>0 && rmsTolerance<=1e-6 && settings.at("integration")=="trapezoidal","Invalid random accuracy settings");
    const auto& response=settings.at("response"); require(response.is_object() && response.size()==2,"Only one node translation response is supported");
    const std::string component=id(response.at("component")); require(component=="x" || component=="y" || component=="z","Unsupported random response component");
    bool responseExists=false; for (const auto& n:input.at("nodes")) responseExists|=n.at("id")==response.at("nodeId"); require(responseExists,"Random response node is missing");
    const auto& modalResult=basis.at("modal"); const auto& modal=modalResult.at("modal"); const auto& modalInput=modalResult.at("input"); const auto& damping=basis.at("damping"); Json spectra;
    require(basis.is_object() && basis.size()==3 && distributed==basis.contains("spectra"),"Invalid frozen random source fields");
    if (distributed) spectra=basis.at("spectra"); else spectra=Json::array({{{"sourceId","legacy-node-source"},{"spectrum",basis.at("spectrum")}}});
    require(spectra.is_array() && spectra.size()==sources.size(),"Random source spectrum count mismatch");
    require(modalResult.at("status")=="complete" && modalResult.at("id")==settings.at("modalAnalysisId") && modalResult.at("projectId")==input.at("projectId")
        && number(modalResult.at("projectRevision"))<=number(input.at("projectRevision")) && modalInput.at("analysisCase").at("method")=="modal"
        && meshNumbersMatch(randomStructuralIdentity(input),randomStructuralIdentity(modalInput)),"Random modal structural/mass basis mismatch");
    require(modal.at("convergence").at("status")=="converged" && modal.at("zeroEnergyModes")==0,"Random response requires converged elastic modes with no zero-energy mechanism");
    require(damping.is_object() && damping.size()==6 && damping.at("analysisId")==modalResult.at("id") && damping.at("createdAt")==modalResult.at("createdAt")
        && damping.at("frequenciesHz").size()==modal.at("modes").size(),"Random damping identity mismatch");
    auto dampingRatio=[&](const Json& value) { require(value.is_object() && value.size()==3 && (value.at("source")=="user" || value.at("source")=="suggestion") && value.at("basis").is_string() && !value.at("basis").get<std::string>().empty(),"Invalid damping provenance"); const double ratio=number(value.at("ratio")); require(ratio>0 && ratio<1,"Invalid modal damping ratio"); return ratio; };
    const double uniform=dampingRatio(damping.at("uniform")); std::map<int,double> overrides;
    for (const auto& o:damping.at("overrides")) { const double mode=number(o.at("modeNumber")); require(o.size()==2 && mode>=1 && mode<=modal.at("modes").size() && mode==std::floor(mode) && !overrides.count(static_cast<int>(mode)),"Invalid numbered damping override"); overrides[static_cast<int>(mode)]=dampingRatio(o.at("value")); }
    require(settings.at("bandHz").is_array() && settings.at("bandHz").size()==2,"Invalid random band");
    const double lo=number(settings.at("bandHz")[0]), hi=number(settings.at("bandHz")[1]); require(lo>=0 && hi>lo && number(damping.at("truncation").at("upperFrequencyHz"))>=hi,"Invalid random band or damping band coverage");
    for (size_t i=0;i<spectra.size();++i) {
        const auto& item=spectra[i]; const auto& spectrum=item.at("spectrum");
        require(item.size()==2 && item.at("sourceId")==sources[i].at("sourceId") && spectrum.at("id")==sources[i].at("psdSpectrumId") && spectrum.at("quantity")=="force" && spectrum.at("excitationUnit")=="kN" && spectrum.at("frequencyUnit")=="Hz" && spectrum.at("densityUnit")=="kN\u00b2/Hz" && spectrum.at("sidedness")=="one-sided" && spectrum.at("interpolation")=="linear" && spectrum.at("outsideBand")=="zero","Random response requires corresponding canonical one-sided force PSD");
        require(settings.at("bandHz")==spectrum.at("band"),"Independent sources must share the full PSD band");
        const auto& points=spectrum.at("points"); require(points.is_array() && points.size()>=2 && points.size()<=10000 && points.front().at("frequency")==lo && points.back().at("frequency")==hi,"Invalid PSD table/band");
        double previousFrequency=-1; for (const auto& p:points) { const double f=number(p.at("frequency")), density=number(p.at("density")); require(p.size()==2 && f>previousFrequency && density>=0,"PSD points must increase strictly with nonnegative density"); previousFrequency=f; }
    }
    const size_t count=modal.at("modes").size(); const bool complete=count==modal.at("counts").at("equations").get<size_t>();
    require(count>=1 && count<=50 && (complete || (count>static_cast<size_t>(increment) && number(modal.at("modes").back().at("frequencyHz"))>=hi)),"Modal truncation/coverage requires more modes");
    phase("assembly");
    // Verify the frozen elastic basis against the actual structural matrices.
    Json modalRequest=request; modalRequest["input"]=modalInput; modalRequest["sourceId"]=modalInput.at("analysisCase").at("id");
    const auto& plan=modalInput.at("meshPlan"); Json selected; for (const auto& level:plan.at("levels")) { require(meshNumbersMatch(level,meshLevel(modalInput,level.at("divisions").get<int>())),"Invalid frozen modal mesh mapping"); if (level.at("divisions")==modal.at("selectedDivisions")) selected=level; }
    require(!selected.is_null() && meshNumbersMatch(plan.at("frames"),meshFrames(modalInput)),"Invalid frozen modal frames");
    auto recomputed=solveModalLevel(modalRequest,selected,static_cast<int>(count),modalInput.at("analysisCase").at("settings").at("modal").at("maxEquations").get<int>(),stage,{});
    require(meshNumbersMatch(recomputed.modes,modal.at("modes")),"Frozen modal shapes/frequencies do not match the structural basis");
    require(meshNumbersMatch(recomputed.eigenproblem,modal.at("eigenproblem")),"Frozen modal calculation coordinates/vectors do not match the structural basis");
    const auto& modalSettings=modalInput.at("analysisCase").at("settings").at("modal");
    const int selectedDivisions=selected.at("divisions").get<int>();
    require(selectedDivisions>=2 && count==modalSettings.at("modeCount").get<size_t>() && recomputed.equations==modal.at("counts").at("equations").get<int>(),"Invalid modal convergence/extraction identity");
    const auto previousLevel=meshLevel(modalInput,selectedDivisions/2);
    const auto coarse=solveModalLevel(modalRequest,previousLevel,static_cast<int>(count),modalSettings.at("maxEquations").get<int>(),stage,{});
    require(coarse.modes.size()==count,"Frozen modal convergence lacks a comparable coarse extraction");
    double frequencyError=0; for (size_t i=0;i<count;++i) { const double a=number(coarse.modes[i]["frequencyHz"]), b=number(recomputed.modes[i]["frequencyHz"]); frequencyError=std::max(frequencyError,std::abs(a-b)/std::max(1e-8,std::max(a,b))); }
    require(frequencyError<=number(modalSettings.at("frequencyTolerance")),"Frozen modal mesh is not frequency-converged");
    std::vector<RandomMode> modes;
    // Participation is checked per action before source cancellation. An exact
    // opposite pair is valid, but missing directional modes must not look converged.
    for (const auto& source:sources) for (const auto& action:source.at("actions")) {
        const Vec3 direction=vector3(action.at("direction"),nullptr,"direction"); const bool node=action.at("kind")=="node";
        const double scale=number(action.at(node ? "scale" : "scalePerM")); double projection=0, shapeScale=0;
        for (size_t i=0;i<count;++i) { const auto shape=randomActionShape(modalInput,modal,selected,i,action); projection=std::max(projection,std::abs(shape.dot(direction))); shapeScale=std::max(shapeScale,shape.norm()); }
        Vec3 freeDirection=direction;
        if (node) for (int axis=0;axis<3;++axis) for (const auto& support:input.at("supports")) if (support.at("nodeId")==action.at("nodeId") && support.at("restraints")[axis]==true) freeDirection[axis]=0;
        const double norm=std::hypot(freeDirection[0],freeDirection[1],freeDirection[2]);
        if (scale!=0 && norm>0 && projection/norm<=1e-10*std::max(1e-30,shapeScale)) throw Failure("random-modal-participation","Extracted modes do not cover the spatial force direction; increase extraction",nullptr,"modeCount");
    }
    for (size_t i=0;i<count;++i) {
        const auto& m=modal.at("modes")[i]; const double frequency=number(m.at("frequencyHz")), omega=std::sqrt(number(m.at("eigenvalue")));
        require(frequency>0 && damping.at("frequenciesHz")[i]==m.at("frequencyHz") && m.at("number")==i+1 && m.at("kind")=="elastic","Invalid frozen mode or damping order");
        double output=0; for (const auto& n:m.at("nodes")) if (n.at("nodeId")==response.at("nodeId")) output=number(n.at("translation").at(component));
        std::vector<double> coefficients;
        for (const auto& source:sources) {
            double generalized=0;
            for (const auto& action:source.at("actions")) {
                const double projection=randomActionShape(modalInput,modal,selected,i,action).dot(vector3(action.at("direction"),nullptr,"direction"));
                const double scale=number(action.at(action.at("kind")=="node" ? "scale" : "scalePerM")), contribution=scale*projection;
                require(std::isfinite(contribution) && !(contribution==0 && scale!=0 && projection!=0),"Random modal spatial coefficient overflows or underflows"); generalized+=contribution;
            }
            const double coefficient=output*generalized; require(std::isfinite(coefficient) && !(coefficient==0 && output!=0 && generalized!=0),"Random modal source coefficient overflows or underflows"); coefficients.push_back(coefficient);
        }
        const int mode=static_cast<int>(i+1); modes.push_back({frequency,omega,overrides.count(mode) ? overrides[mode] : uniform,coefficients});
    }
    std::set<double> seeded; for (const auto& item:spectra) for (const auto& p:item.at("spectrum").at("points")) seeded.insert(number(p.at("frequency")));
    for (int i=1;i<initialPoints-1;++i) seeded.insert(lo+(hi-lo)*i/(initialPoints-1));
    for (const auto& m:modes) for (int n:{0,-1,1,-2,2,-4,4,-8,8}) { const double f=m.frequency+n*m.damping*m.frequency; if (f>lo && f<hi) seeded.insert(f); }
    std::vector<double> grid(seeded.begin(),seeded.end()), density, previousDensity; Json runs=Json::array(); RandomRun previousRun; bool converged=false;
    auto failConvergence=[&](const std::string& code,const std::string& message,const std::string& field,const Json& detail=Json::object()) {
        Failure failure(code,message,nullptr,field);
        failure.diagnostic["randomConvergence"]={{"status","failed"},{"pointBudget",maxPoints},{"refinementBudget",refinements},{"attemptedPoints",grid.size()},{"runs",runs},{"detail",detail}};
        throw failure;
    };
    phase("solve");
    for (int iteration=0;iteration<=refinements;++iteration) {
        if (grid.size()>static_cast<size_t>(maxPoints)) failConvergence("random-frequency-budget","Frequency point budget exhausted before PSD/integration convergence","frequencyPoints");
        density=randomDensities(modes,spectra,grid,count); RandomRun run; run.points=static_cast<int>(grid.size()); run.variance=randomVariance(grid,density); run.rms=std::sqrt(run.variance); run.peak=*std::max_element(density.begin(),density.end());
        Json record={{"points",run.points},{"variance",run.variance},{"rms",run.rms}};
        if (iteration) {
            for (size_t i=1;i<density.size();i+=2) run.curveDifference=std::max(run.curveDifference,std::abs(density[i]-(previousDensity[(i-1)/2]/2+previousDensity[(i+1)/2]/2)));
            run.varianceDifference=std::abs(run.variance-previousRun.variance); run.rmsDifference=std::abs(run.rms-previousRun.rms);
            record["curveError"]=run.curveDifference/std::max(1e-30,run.peak); record["varianceError"]=run.varianceDifference/std::max(1e-30,std::max(run.variance,previousRun.variance)); record["rmsError"]=run.rmsDifference/std::max(1e-30,std::max(run.rms,previousRun.rms));
            converged=run.curveDifference<=psdTolerance+tolerance*run.peak && run.varianceDifference<=varianceTolerance+tolerance*std::max(run.variance,previousRun.variance) && run.rmsDifference<=rmsTolerance+tolerance*std::max(run.rms,previousRun.rms);
        }
        runs.push_back(record); previousRun=run; if (converged) break;
        if (iteration==refinements) failConvergence("random-integration-budget","Refinement budget exhausted before PSD/integration convergence","integration");
        if (grid.size()*2-1>static_cast<size_t>(maxPoints)) failConvergence("random-frequency-budget","Frequency point budget exhausted before PSD/integration convergence","frequencyPoints",{{"nextPoints",grid.size()*2-1}});
        previousDensity=density; std::vector<double> refined; refined.reserve(grid.size()*2-1); refined.push_back(grid.front());
        for (size_t i=1;i<grid.size();++i) { const double mid=grid[i-1]+(grid[i]-grid[i-1])/2; if (!(mid>grid[i-1] && mid<grid[i])) throw Failure("random-numeric-range","Frequency grid exceeds floating point resolution",nullptr,"frequencyPoints"); refined.push_back(mid); refined.push_back(grid[i]); }
        grid=std::move(refined);
    }
    const size_t lower=complete ? count : count-increment; const auto reduced=randomDensities(modes,spectra,grid,lower); const double reducedRms=std::sqrt(randomVariance(grid,reduced)); double difference=0, peak=0;
    for (size_t i=0;i<grid.size();++i) { difference=std::max(difference,std::abs(density[i]-reduced[i])); peak=std::max(peak,std::max(density[i],reduced[i])); }
    const double rmsDifference=std::abs(previousRun.rms-reducedRms), rmsScale=std::max(previousRun.rms,reducedRms);
    if (difference>psdTolerance+tolerance*peak || rmsDifference>rmsTolerance+tolerance*rmsScale) failConvergence("random-modal-truncation","Modal PSD/RMS changes exceed registered tolerance; increase modal extraction and rebind damping","modeCount",{{"lowerModeCount",lower},{"upperModeCount",count},{"curveError",difference/std::max(1e-30,peak)},{"rmsError",rmsDifference/std::max(1e-30,rmsScale)}});
    phase("recovery"); Json output=Json::array(); for (size_t i=0;i<grid.size();++i) output.push_back({{"frequencyHz",grid[i]},{"density",density[i]}});
    Json record={{"coordinateSystem","global XYZ"},{"sidedness","one-sided"},{"frequencyUnit","Hz"},{"densityUnit","m²/Hz"},{"rmsUnit","m"},{"response",response},{"modalAnalysisId",modalResult.at("id")},{"modeCount",count},{"points",output},{"variance",previousRun.variance},{"rms",previousRun.rms},
        {"convergence",{{"status","converged"},{"runs",runs},{"modal",{{"status",complete ? "complete-basis" : "converged"},{"lowerModeCount",lower},{"upperModeCount",count},{"curveError",difference/std::max(1e-30,peak)},{"rmsError",rmsDifference/std::max(1e-30,rmsScale)}}}}}};
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"origin",request["origin"]},{"sourceId",request["sourceId"]},{"dependencies",Json::array()},{"solver",randomSolver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},{"nodes",Json::array()},{"members",Json::array()},{"random",record},{"service",service}};
}
