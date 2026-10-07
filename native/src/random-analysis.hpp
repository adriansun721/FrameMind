#include <complex>

struct RandomMode { double frequency, omega, coefficient, damping; };
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
static std::vector<double> randomDensities(const std::vector<RandomMode>& modes, const Json& spectrum, const std::vector<double>& grid, size_t count) {
    std::vector<double> result; result.reserve(grid.size());
    for (double frequency:grid) {
        const double omega=2*std::acos(-1.0)*frequency, density=randomSpectrum(spectrum.at("points"),frequency);
        double real=0, imaginary=0;
        for (size_t i=0;i<count;++i) {
            const auto& m=modes[i]; const double re=m.omega*m.omega-omega*omega, im=2*m.damping*m.omega*omega, denominator=re*re+im*im;
            if (!(denominator>0) || !std::isfinite(denominator)) throw Failure("random-numeric-range","Random transfer denominator exceeds finite precision",nullptr,"random");
            real+=m.coefficient*re/denominator; imaginary-=m.coefficient*im/denominator;
        }
        const double value=(real*real+imaginary*imaginary)*density;
        if (!std::isfinite(value) || value<0 || (value==0 && density>0 && (real!=0 || imaginary!=0))) throw Failure("random-numeric-range","Random PSD overflows or nonzero density underflows",nullptr,"random");
        result.push_back(value);
    }
    return result;
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
    const std::set<std::string> keys={"modalAnalysisId","psdSpectrumId","excitation","response","bandHz","frequencyPoints","maxFrequencyPoints","maxRefinements","modeIncrement","relativeTolerance","absolutePsdTolerance","absoluteVarianceTolerance","absoluteRmsTolerance","integration"};
    require(settings.is_object() && settings.size()==keys.size(),"Invalid random settings fields"); for (const auto& key:keys) require(settings.contains(key),"Missing random setting");
    auto integer=[&](const std::string& key,int low,int high) { const double n=number(settings.at(key)); require(n>=low && n<=high && std::floor(n)==n,"Invalid random integer budget",nullptr,key); return static_cast<int>(n); };
    const int initialPoints=integer("frequencyPoints",3,10001), maxPoints=integer("maxFrequencyPoints",initialPoints,20001), refinements=integer("maxRefinements",1,12), increment=integer("modeIncrement",1,49);
    const double tolerance=number(settings.at("relativeTolerance")), psdTolerance=number(settings.at("absolutePsdTolerance")), varianceTolerance=number(settings.at("absoluteVarianceTolerance")), rmsTolerance=number(settings.at("absoluteRmsTolerance"));
    require(tolerance>0 && tolerance<=.01 && psdTolerance>0 && psdTolerance<=1e-12 && varianceTolerance>0 && varianceTolerance<=1e-12 && rmsTolerance>0 && rmsTolerance<=1e-6 && settings.at("integration")=="trapezoidal","Invalid random accuracy settings");
    const auto& excitation=settings.at("excitation"); const auto& response=settings.at("response");
    require(excitation.is_object() && excitation.size()==3 && response.is_object() && response.size()==2 && excitation.at("direction").is_object() && excitation.at("direction").size()==3,"Only one node force source and one node translation component are supported");
    const Vec3 direction=vector3(excitation.at("direction"),nullptr,"direction"); const double scale=number(excitation.at("scale"));
    require(std::abs(direction.norm()-1)<=1e-10 && std::isfinite(scale),"Random direction must be a global unit vector and scale finite");
    const std::string component=id(response.at("component")); require(component=="x" || component=="y" || component=="z","Unsupported random response component");
    bool forceExists=false, responseExists=false; for (const auto& n:input.at("nodes")) { forceExists|=n.at("id")==excitation.at("nodeId"); responseExists|=n.at("id")==response.at("nodeId"); }
    require(forceExists && responseExists,"Random source or response node is missing");
    const auto& modalResult=basis.at("modal"); const auto& modal=modalResult.at("modal"); const auto& modalInput=modalResult.at("input"); const auto& damping=basis.at("damping"); const auto& spectrum=basis.at("spectrum");
    require(modalResult.at("status")=="complete" && modalResult.at("id")==settings.at("modalAnalysisId") && modalResult.at("projectId")==input.at("projectId")
        && number(modalResult.at("projectRevision"))<=number(input.at("projectRevision")) && modalInput.at("analysisCase").at("method")=="modal"
        && meshNumbersMatch(randomStructuralIdentity(input),randomStructuralIdentity(modalInput)),"Random modal structural/mass basis mismatch");
    require(modal.at("convergence").at("status")=="converged" && modal.at("zeroEnergyModes")==0,"Random response requires converged elastic modes with no zero-energy mechanism");
    require(damping.is_object() && damping.size()==6 && damping.at("analysisId")==modalResult.at("id") && damping.at("createdAt")==modalResult.at("createdAt")
        && damping.at("frequenciesHz").size()==modal.at("modes").size(),"Random damping identity mismatch");
    auto dampingRatio=[&](const Json& value) { require(value.is_object() && value.size()==3 && (value.at("source")=="user" || value.at("source")=="suggestion") && value.at("basis").is_string() && !value.at("basis").get<std::string>().empty(),"Invalid damping provenance"); const double ratio=number(value.at("ratio")); require(ratio>0 && ratio<1,"Invalid modal damping ratio"); return ratio; };
    const double uniform=dampingRatio(damping.at("uniform")); std::map<int,double> overrides;
    for (const auto& o:damping.at("overrides")) { const double mode=number(o.at("modeNumber")); require(o.size()==2 && mode>=1 && mode<=modal.at("modes").size() && mode==std::floor(mode) && !overrides.count(static_cast<int>(mode)),"Invalid numbered damping override"); overrides[static_cast<int>(mode)]=dampingRatio(o.at("value")); }
    require(spectrum.at("id")==settings.at("psdSpectrumId") && spectrum.at("quantity")=="force" && spectrum.at("excitationUnit")=="kN" && spectrum.at("frequencyUnit")=="Hz" && spectrum.at("densityUnit")=="kN²/Hz" && spectrum.at("sidedness")=="one-sided" && spectrum.at("interpolation")=="linear" && spectrum.at("outsideBand")=="zero","Random response requires canonical one-sided force PSD");
    require(settings.at("bandHz").is_array() && settings.at("bandHz").size()==2 && settings.at("bandHz")==spectrum.at("band"),"Random response band must equal the full input PSD band");
    const double lo=number(settings.at("bandHz")[0]), hi=number(settings.at("bandHz")[1]); require(lo>=0 && hi>lo && number(damping.at("truncation").at("upperFrequencyHz"))>=hi,"Invalid random band or damping band coverage");
    const auto& points=spectrum.at("points"); require(points.is_array() && points.size()>=2 && points.size()<=10000 && points.front().at("frequency")==lo && points.back().at("frequency")==hi,"Invalid PSD table/band");
    double previousFrequency=-1; for (const auto& p:points) { const double f=number(p.at("frequency")), density=number(p.at("density")); require(p.size()==2 && f>previousFrequency && density>=0,"PSD points must increase strictly with nonnegative density"); previousFrequency=f; }
    const size_t count=modal.at("modes").size(); const bool complete=count==modal.at("counts").at("equations").get<size_t>();
    require(count>=1 && count<=50 && (complete || (count>static_cast<size_t>(increment) && number(modal.at("modes").back().at("frequencyHz"))>=hi)),"Modal truncation/coverage requires more modes");
    phase("assembly");
    // Verify the frozen elastic basis against the actual structural matrices.
    Json modalRequest=request; modalRequest["input"]=modalInput; modalRequest["sourceId"]=modalInput.at("analysisCase").at("id");
    const auto& plan=modalInput.at("meshPlan"); Json selected; for (const auto& level:plan.at("levels")) { require(meshNumbersMatch(level,meshLevel(modalInput,level.at("divisions").get<int>())),"Invalid frozen modal mesh mapping"); if (level.at("divisions")==modal.at("selectedDivisions")) selected=level; }
    require(!selected.is_null() && meshNumbersMatch(plan.at("frames"),meshFrames(modalInput)),"Invalid frozen modal frames");
    auto recomputed=solveModalLevel(modalRequest,selected,static_cast<int>(count),modalInput.at("analysisCase").at("settings").at("modal").at("maxEquations").get<int>(),stage,{});
    require(meshNumbersMatch(recomputed.modes,modal.at("modes")),"Frozen modal shapes/frequencies do not match the structural basis");
    const auto& modalSettings=modalInput.at("analysisCase").at("settings").at("modal");
    const int selectedDivisions=selected.at("divisions").get<int>();
    require(selectedDivisions>=2 && count==modalSettings.at("modeCount").get<size_t>() && recomputed.equations==modal.at("counts").at("equations").get<int>(),"Invalid modal convergence/extraction identity");
    const auto previousLevel=meshLevel(modalInput,selectedDivisions/2);
    const auto coarse=solveModalLevel(modalRequest,previousLevel,static_cast<int>(count),modalSettings.at("maxEquations").get<int>(),stage,{});
    require(coarse.modes.size()==count,"Frozen modal convergence lacks a comparable coarse extraction");
    double frequencyError=0; for (size_t i=0;i<count;++i) { const double a=number(coarse.modes[i]["frequencyHz"]), b=number(recomputed.modes[i]["frequencyHz"]); frequencyError=std::max(frequencyError,std::abs(a-b)/std::max(1e-8,std::max(a,b))); }
    require(frequencyError<=number(modalSettings.at("frequencyTolerance")),"Frozen modal mesh is not frequency-converged");
    std::vector<RandomMode> modes; double sourceProjection=0, sourceShapeScale=0;
    for (size_t i=0;i<count;++i) {
        const auto& m=modal.at("modes")[i]; const double frequency=number(m.at("frequencyHz")), omega=std::sqrt(number(m.at("eigenvalue")));
        require(frequency>0 && damping.at("frequenciesHz")[i]==m.at("frequencyHz") && m.at("number")==i+1 && m.at("kind")=="elastic","Invalid frozen mode or damping order");
        Vec3 force=Vec3::Zero(); double output=0;
        for (const auto& n:m.at("nodes")) { if (n.at("nodeId")==excitation.at("nodeId")) force=vector3(n.at("translation"),nullptr,"translation"); if (n.at("nodeId")==response.at("nodeId")) output=number(n.at("translation").at(component)); }
        const double coefficient=output*scale*force.dot(direction); require(std::isfinite(coefficient) && !(coefficient==0 && output!=0 && scale!=0 && force.dot(direction)!=0),"Random modal force coefficient overflows or underflows");
        sourceProjection=std::max(sourceProjection,std::abs(force.dot(direction))); sourceShapeScale=std::max(sourceShapeScale,force.norm());
        const int mode=static_cast<int>(i+1); modes.push_back({frequency,omega,coefficient,overrides.count(mode) ? overrides[mode] : uniform});
    }
    Vec3 freeDirection=direction; for (int axis=0;axis<3;++axis) for (const auto& support:input.at("supports")) if (support.at("nodeId")==excitation.at("nodeId") && support.at("restraints")[axis]==true) freeDirection[axis]=0;
    const double freeDirectionNorm=std::hypot(freeDirection[0],freeDirection[1],freeDirection[2]);
    if (scale!=0 && freeDirectionNorm>0 && sourceProjection/freeDirectionNorm<=1e-10*std::max(1e-30,sourceShapeScale)) throw Failure("random-modal-participation","Extracted modes do not cover the node force direction; increase extraction instead of accepting zero participation",nullptr,"modeCount");
    std::set<double> seeded; for (const auto& p:points) seeded.insert(number(p.at("frequency")));
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
        density=randomDensities(modes,spectrum,grid,count); RandomRun run; run.points=static_cast<int>(grid.size()); run.variance=randomVariance(grid,density); run.rms=std::sqrt(run.variance); run.peak=*std::max_element(density.begin(),density.end());
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
    const size_t lower=complete ? count : count-increment; const auto reduced=randomDensities(modes,spectrum,grid,lower); const double reducedRms=std::sqrt(randomVariance(grid,reduced)); double difference=0, peak=0;
    for (size_t i=0;i<grid.size();++i) { difference=std::max(difference,std::abs(density[i]-reduced[i])); peak=std::max(peak,std::max(density[i],reduced[i])); }
    const double rmsDifference=std::abs(previousRun.rms-reducedRms), rmsScale=std::max(previousRun.rms,reducedRms);
    if (difference>psdTolerance+tolerance*peak || rmsDifference>rmsTolerance+tolerance*rmsScale) failConvergence("random-modal-truncation","Modal PSD/RMS changes exceed registered tolerance; increase modal extraction and rebind damping","modeCount",{{"lowerModeCount",lower},{"upperModeCount",count},{"curveError",difference/std::max(1e-30,peak)},{"rmsError",rmsDifference/std::max(1e-30,rmsScale)}});
    phase("recovery"); Json output=Json::array(); for (size_t i=0;i<grid.size();++i) output.push_back({{"frequencyHz",grid[i]},{"density",density[i]}});
    Json record={{"coordinateSystem","global XYZ"},{"sidedness","one-sided"},{"frequencyUnit","Hz"},{"densityUnit","m²/Hz"},{"rmsUnit","m"},{"response",response},{"modalAnalysisId",modalResult.at("id")},{"modeCount",count},{"points",output},{"variance",previousRun.variance},{"rms",previousRun.rms},
        {"convergence",{{"status","converged"},{"runs",runs},{"modal",{{"status",complete ? "complete-basis" : "converged"},{"lowerModeCount",lower},{"upperModeCount",count},{"curveError",difference/std::max(1e-30,peak)},{"rmsError",rmsDifference/std::max(1e-30,rmsScale)}}}}}};
    Json service={{"version",request["version"]},{"requestId",request["requestId"]},{"analysisId",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"origin",request["origin"]},{"sourceId",request["sourceId"]},{"dependencies",Json::array()},{"solver",randomSolver},{"status","complete"},{"stages",stages}};
    return {{"id",request["analysisId"]},{"projectId",input["projectId"]},{"projectRevision",input["projectRevision"]},{"createdAt",now()},{"status","complete"},{"input",input},{"nodes",Json::array()},{"members",Json::array()},{"random",record},{"service",service}};
}
