// Test-only executable. Never copied into native/bin or installers.
#define NOMINMAX
#include <windows.h>
#include <json.hpp>
#include <iostream>
#include <iterator>
using Json=nlohmann::json;
int main() {
    const std::string bytes((std::istreambuf_iterator<char>(std::cin)),{});
    const auto request=Json::parse(bytes);
    const auto requestId=request.at("requestId");
    auto phase=[&](const char* stage) {
        std::cout << Json({{"kind","phase"},{"requestId",requestId},{"record",{{"stage",stage},{"startedAt","2026-10-05T00:00:00Z"}}}}).dump() << '\n' << std::flush;
    };
    phase("model-check"); phase("assembly"); phase("solve");
    const auto fault=request.value("fault","wait");
    if (fault=="crash") { TerminateProcess(GetCurrentProcess(),0xC0000005); return 9; }
    if (fault=="truncated") { std::cout << "{\"kind\":\"result\"" << std::flush; return 3; }
    if (fault=="protocol") { std::cout << Json({{"kind","result"},{"requestId","request_foreign"}}).dump() << '\n'; return 0; }
    Sleep(10000);
    std::cout << Json({{"kind","error"},{"requestId",requestId},{"error",{{"name","AnalysisFailure"},{"stage","solve"},
        {"diagnostics",Json::array({{{"code","injected-error"},{"message","Injected solver exception"}}})}}}}).dump() << '\n';
    return 1;
}
