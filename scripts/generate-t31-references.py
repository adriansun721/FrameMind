"""Independent continuum references; no FrameMind/finite-element imports.

Run with Python + sympy. Exact sectional equilibrium and polynomial integration
give virtual-work responses. Fixed-tip/closed chains use six force-method
redundants: minimize strain energy to impose zero tip displacement/rotation.
"""
import json
from pathlib import Path
import sympy as S

ROOT = Path(__file__).resolve().parents[1]
V = S.Matrix
ZERO = V([0, 0, 0])
X, Y, Z = V([1, 0, 0]), V([0, 1, 0]), V([0, 0, 1])
DEFAULT = dict(E=200, nu="0.3", rho=7850, A="0.01", Iy="0.0002", Iz="0.0001", J="0.00015")
CASES = []


def vector(values):
    return V([S.Rational(str(v)) for v in values])


def number(value):
    return float(S.N(value, 17))


def values(items):
    return [number(v) for v in items]


def register(name, points, axes, loads=(), uniform=(), fixed_tip=False, material=None, aliases=None, source="Continuum equilibrium + unit-load virtual work", rotation=0, self_weight=False, factors=None):
    mat = {**DEFAULT, **(material or {})}
    pts = [vector(p) for p in points]
    loads = [(i, vector(f), vector(m)) for i, f, m in loads]
    distributed = [vector(q) for q in uniform] if uniform else [ZERO] * len(axes)
    e, nu, rho, a, iy, iz, j = [S.Rational(str(mat[k])) for k in ["E", "nu", "rho", "A", "Iy", "Iz", "J"]]
    stiffness = [e * 10**6 * a, e * 10**6 / (2 * (1 + nu)) * j, e * 10**6 * iy, e * 10**6 * iz]
    x = S.Symbol("s", real=True)
    redundant = V(S.symbols("R0:6"))
    lengths = [(pts[i+1] - pts[i]).norm() for i in range(len(axes))]

    def fields(extra=()):
        out = []
        for i, basis in enumerate(axes):
            position = pts[i] + basis[0] * x
            force, moment = ZERO.copy(), ZERO.copy()
            for node, f, m in [*loads, *extra]:
                if node > i:
                    force += f
                    moment += m + (pts[node] - position).cross(f)
            for k in range(i, len(axes)):
                start = position if k == i else pts[k]
                span = lengths[k] - x if k == i else lengths[k]
                f = distributed[k] * span
                force += f
                moment += ((start + pts[k+1]) / 2 - position).cross(f)
            out.append((force, moment))
        return out

    def components(field, basis):
        f, m = field
        return [f.dot(basis[0]), m.dot(basis[0]), m.dot(basis[1]), m.dot(basis[2])]

    def product(left, right):
        total = 0
        for i, basis in enumerate(axes):
            c, d = components(left[i], basis), components(right[i], basis)
            total += S.integrate(sum(c[k] * d[k] / stiffness[k] for k in range(4)), (x, 0, lengths[i]))
        return total

    real = fields([(len(pts)-1, redundant[:3, :], redundant[3:, :])]) if fixed_tip else fields()
    reaction_tip = ZERO.col_join(ZERO)
    if fixed_tip:
        energy = product(real, real) / 2
        equations = [S.diff(energy, r) for r in redundant]
        matrix, rhs = S.linear_eq_to_matrix(equations, list(redundant))
        reaction_tip = matrix.inv() * rhs
        substitutions = dict(zip(redundant, reaction_tip))
        real = [(f.subs(substitutions), m.subs(substitutions)) for f, m in real]

    # Unit loads have no distributed loads and do not include real loads.
    def virtual(node, dof):
        unit = V([int(k == dof % 3) for k in range(3)])
        force = unit if dof < 3 else ZERO
        moment = unit if dof >= 3 else ZERO
        return [(force, moment + (pts[node] - (pts[i] + basis[0] * x)).cross(force)) if i < node else (ZERO, ZERO) for i, basis in enumerate(axes)]

    node_results = []
    for node in range(len(pts)):
        response = [S.simplify(product(real, virtual(node, dof))) for dof in range(6)]
        reaction = [-v for v in real[0][0].subs(x, 0)] + [-v for v in real[0][1].subs(x, 0)] if node == 0 else [0]*6
        if fixed_tip and node == len(pts)-1:
            reaction = list(reaction_tip)
        node_results.append(dict(response=values(response), reaction=values(reaction)))

    members = []
    for i, basis in enumerate(axes):
        f, m = real[i]
        sectional = [f.dot(b) for b in basis] + [m.dot(b) for b in basis]
        members.append(dict(start=values([-v.subs(x, 0) for v in sectional]), end=values([v.subs(x, lengths[i]) for v in sectional]), stations=[dict(position=number(lengths[i]*t), forces=values([v.subs(x, lengths[i]*t) for v in sectional])) for t in [0, S.Rational(1, 2), 1]]))
    if aliases:
        for original, target in aliases.items():
            node_results[target]["reaction"] = [a+b for a,b in zip(node_results[target]["reaction"], node_results[original]["reaction"])]
        node_results = [n for i,n in enumerate(node_results) if i not in aliases]
    CASES.append(dict(id=name, source=source, input=dict(points=points, axes=[[values(b) for b in basis] for basis in axes], material={k:float(v) for k,v in mat.items()}, loads=[dict(node=i, force=values(f), moment=values(m)) for i,f,m in loads], uniform=[values(q) for q in distributed], fixedTip=fixed_tip, aliases=aliases or {}, rotation=rotation, selfWeight=self_weight, factors=factors), reference=dict(nodes=node_results, members=members)))


def main():
    for k, name in enumerate(["axial", "bend-y", "bend-z", "torsion", "moment-y", "moment-z"]):
        f = [0, 0, 0]; m = [0, 0, 0]
        (f if k < 3 else m)[k % 3] = [8, 5, -3, 2, 1.5, -1.25][k]
        register(name, [[0,0,0],[4,0,0]], [(X,Y,Z)], [(1,f,m)])
    f, m = [8,5,-3], [2,1.5,-1.25]
    register("six-components", [[0,0,0],[4,0,0]], [(X,Y,Z)], [(1,f,m)])
    register("vertical", [[0,0,0],[0,0,4]], [(Z,X,Y)], [(1,f,m)])
    register("skew-rotated-section", [[1,2,3],[S.Rational(17,5),S.Rational(26,5),3]], [(V([S.Rational(3,5),S.Rational(4,5),0]), Z, V([S.Rational(4,5),-S.Rational(3,5),0]))], [(1,f,m)], rotation=90)
    register("uniform-local", [[0,0,0],[4,0,0]], [(X,Y,Z)], uniform=[[2,-3,4]])
    register("uniform-global-skew", [[0,0,0],[S.Rational(12,5),S.Rational(16,5),0]], [(V([S.Rational(3,5),S.Rational(4,5),0]),V([-S.Rational(4,5),S.Rational(3,5),0]),Z)], uniform=[[2,-3,4]])
    register("self-weight", [[0,0,0],[4,0,0]], [(X,Y,Z)], uniform=[[0,0,-S.Rational(154017,200000)]], self_weight=True)
    register("case-LC1", [[0,0,0],[4,0,0]], [(X,Y,Z)], [(1,[10,12,14],[2,3,4])])
    register("case-LC2", [[0,0,0],[4,0,0]], [(X,Y,Z)], [(1,[-4,6,-8],[-1,2,-3])], uniform=[[1,-3,S.Rational(245983,200000)]])
    register("combination-negative", [[0,0,0],[4,0,0]], [(X,Y,Z)], [(1,[17,15,25],[S.Rational(7,2),S.Rational(7,2),S.Rational(15,2)])], uniform=[[-S.Rational(1,2),S.Rational(3,2),-S.Rational(245983,400000)]], factors=[1.5,-0.5])
    register("combination-zero", [[0,0,0],[4,0,0]], [(X,Y,Z)], factors=[0,0])
    register("fixed-fixed-uniform", [[0,0,0],[4,0,0],[8,0,0]], [(X,Y,Z)]*2, uniform=[[0,-3,0]]*2, fixed_tip=True)
    register("spatial-chain", [[0,0,0],[4,0,0],[4,3,0],[4,3,2]], [(X,Y,Z),(Y,-X,Z),(Z,X,Y)], [(3,f,m)], source="ADR-0004 + independent continuum virtual-work reproduction")
    register("closed-spatial", [[0,0,0],[4,0,0],[4,3,0],[4,3,2],[0,3,2],[0,0,2],[0,0,0]], [(X,Y,Z),(Y,-X,Z),(Z,X,Y),(-X,-Y,Z),(-Y,X,Z),(-Z,-X,Y)], [(3,f,m)], fixed_tip=True, aliases={6:0}, source="Six-redundant force method, exact continuum energy compatibility")
    diagonal = V([1/S.sqrt(2),1/S.sqrt(2),0])
    register("textbook-2-1", [[0,0,0],[1.5,1.5,0],[3,3,0],[4.5,3,0],[6,3,0]], [(diagonal,V([-1/S.sqrt(2),1/S.sqrt(2),0]),Z)]*2+[(X,Y,Z)]*2, [(1,[40,0,0],[0,0,0]),(2,[20,-20,0],[0,0,0]),(3,[0,0,0],[0,0,18])], fixed_tip=True, material=dict(A="0.0165",Iz="0.0000675"), source="计算结构力学 (2014), example 2-1, printed pp.42-46 / PDF pp.51-55; independently recomputed by force method")
    register("textbook-2-1-condensed", [[0,0,0],[3,3,0],[6,3,0]], [(diagonal,V([-1/S.sqrt(2),1/S.sqrt(2),0]),Z),(X,Y,Z)], [(1,[40,-26,0],[0,0,12])], fixed_tip=True, material=dict(A="0.0165",Iz="0.0000675"), source="计算结构力学 example 2-1, printed p.43 FA=(40,-26,-1200) kN/kN·cm; theta_book=-rz, so physical Mz=+12 kN·m. Distinct reduced-load model, not original loads")
    register("textbook-2-1-consistent", [[0,0,0],[3,3,0],[6,3,0]], [(diagonal,V([-1/S.sqrt(2),1/S.sqrt(2),0]),Z),(X,Y,Z)], [(1,[40,-29,0],[0,0,S.Rational(21,2)])], fixed_tip=True, material=dict(A="0.0165",Iz="0.0000675"), source="Independent original-load condensation: (20,0,+15)+(20,-20,0)+(0,-9,-4.5)=(40,-29,+10.5); corner response must match the original five-node continuum solution")
    output = ROOT / "src/validation/t31-references.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    # Sympy rationals in input geometry are converted without using FE code.
    output.write_text(json.dumps(dict(method="exact-continuum-virtual-work-force-method", units=dict(length="m",force="kN",moment="kN·m",rotation="rad"), cases=CASES), indent=2, ensure_ascii=False, default=number)+"\n", encoding="utf-8")
    print(f"Registered {len(CASES)} independent references in {output}")


if __name__ == "__main__":
    main()
