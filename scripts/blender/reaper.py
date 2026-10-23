"""
Builds the reaper character (DESIGN.md §2.5: soft vinyl-toy chibi, chin on hand, coffee-stirrer scythe),
rigs it and authors one animation clip per scene action, then exports apps/web/public/models/reaper.glb.

    blender -b -P scripts/blender/reaper.py -- apps/web/public/models/reaper.glb

Blender is Z-up with the character facing -Y; the glTF exporter converts to three.js Y-up / +Z.
Clip names match the scene's ReaperAction / IdleAction names.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "reaper.glb"
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS


# ── materials ───────────────────────────────────────────────────────────────

def material(name, color, roughness=0.6, metallic=0.0, emission=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    return m


def srgb(hex_color):
    """'#rrggbb' → linear RGB (glTF stores linear factors)."""
    c = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


ROBE = material("robe", srgb("#2a2738"), 0.78)
ROBE_SHADE = material("robe_shade", srgb("#1f1c2b"), 0.8)
BONE = material("bone", srgb("#f4ecdf"), 0.35)
EYE = material("eye", srgb("#17141f"), 0.15)
SHINE = material("shine", (1, 1, 1), 0.2, emission=(1, 1, 1))
WOOD = material("stirrer", srgb("#8a5a3b"), 0.55)
BLADE = material("blade", srgb("#d8d4cc"), 0.3, metallic=0.35)
GLASS = material("glass", srgb("#cfe9ff"), 0.05, alpha=0.45)
BLUSH = material("blush", srgb("#f2a6a0"), 0.5)


# ── geometry helpers ────────────────────────────────────────────────────────

def link(obj):
    scene.collection.objects.link(obj)
    return obj


def finish(obj, mat, smooth=True, subsurf=0):
    obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    if subsurf:
        mod = obj.modifiers.new("subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    return obj


def lathe(name, profile, segments=40):
    """Revolves (radius, z) points around Z."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), cent=(0, 0, 0), steps=segments, angle=math.tau)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh)
    bm.free()
    return link(bpy.data.objects.new(name, mesh))


def sphere(name, radius, location, scale=(1, 1, 1), rotation=(0, 0, 0), segments=24, rings=14):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = rotation
    return obj


def capsule(name, radius, length, location, rotation):
    """Rounded limb: a cylinder with hemispherical ends, along local Z."""
    profile = [(0, -length / 2 - radius)]
    for i in range(1, 7):
        a = math.pi / 2 * (i / 6)
        profile.append((radius * math.sin(a), -length / 2 - radius * math.cos(a)))
    for i in range(0, 7):
        a = math.pi / 2 * (i / 6)
        profile.append((radius * math.cos(a), length / 2 + radius * math.sin(a)))
    profile.append((0, length / 2 + radius))
    obj = lathe(name, profile, 24)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def torus(name, major, minor, location, rotation=(0, 0, 0), arc=math.tau, segments=40):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    ring = []
    for j in range(12):
        a = math.tau * j / 12
        ring.append(bm.verts.new((major + minor * math.cos(a), 0, minor * math.sin(a))))
    faces_ring = [bm.edges.new((ring[j], ring[(j + 1) % 12])) for j in range(12)]
    bmesh.ops.spin(bm, geom=ring + faces_ring, axis=(0, 0, 1), cent=(0, 0, 0), steps=segments, angle=arc)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = location
    obj.rotation_euler = rotation
    return obj


# ── model (faces -Y) ────────────────────────────────────────────────────────

parts = {}  # object → bone name

robe = finish(
    lathe("robe", [(0, 0), (0.62, 0), (0.61, 0.06), (0.55, 0.3), (0.47, 0.7), (0.4, 0.98), (0.3, 1.22), (0.12, 1.32), (0, 1.33)]),
    ROBE,
    subsurf=1,
)
parts[robe] = "spine"

# Hood: a slightly tall ball, opened at the front by a boolean so the face sits inside it.
# Dense sphere and no subdivision: a boolean on a subdivided mesh leaves a ragged rim.
hood = finish(sphere("hood", 0.47, (0, 0, 1.56), (1, 1, 1.05), segments=64, rings=40), ROBE)
cutter = sphere("hood_cut", 0.36, (0, -0.32, 1.52), (1.05, 1, 1.1), segments=64, rings=40)
boolean = hood.modifiers.new("opening", "BOOLEAN")
boolean.operation = "DIFFERENCE"
boolean.object = cutter
cutter.hide_set(True)
cutter.hide_render = True
parts[hood] = "head"

tip = finish(lathe("hood_tip", [(0.0, 0), (0.2, 0), (0.14, 0.2), (0.06, 0.38), (0, 0.46)], 24), ROBE, subsurf=1)
tip.location = (0.04, 0.24, 1.86)
tip.rotation_euler = Euler((math.radians(-58), math.radians(10), 0))
parts[tip] = "head"

face = finish(sphere("face", 0.35, (0, -0.13, 1.52), (1, 0.85, 0.95), segments=40, rings=24), BONE)
parts[face] = "head"
for side in (-1, 1):
    eye = finish(sphere(f"eye_{side}", 0.095, (side * 0.13, -0.43, 1.54), (0.78, 0.42, 1), (0, 0, side * -0.35), 16, 10), EYE)
    shine = finish(sphere(f"shine_{side}", 0.024, (side * 0.115, -0.47, 1.585), segments=12, rings=8), SHINE)
    cheek = finish(sphere(f"blush_{side}", 0.05, (side * 0.22, -0.4, 1.43), (1, 0.4, 0.6), segments=12, rings=8), BLUSH)
    for o in (eye, shine, cheek):
        parts[o] = "head"
nose = finish(sphere("nose", 0.022, (0, -0.465, 1.47), (1.2, 0.5, 0.7), segments=12, rings=8), EYE)
parts[nose] = "head"

# Right arm props the chin (and stamps); left arm rests on the ledger (and writes).
sleeve_r = finish(capsule("sleeve_r", 0.1, 0.32, (0.3, -0.24, 1.2), (math.radians(-50), 0, math.radians(-28))), ROBE_SHADE)
hand_r = finish(sphere("hand_r", 0.1, (0.21, -0.5, 1.33)), BONE)
sleeve_l = finish(capsule("sleeve_l", 0.1, 0.36, (-0.34, -0.3, 0.98), (math.radians(-70), 0, math.radians(18))), ROBE_SHADE)
hand_l = finish(sphere("hand_l", 0.1, (-0.3, -0.56, 0.95)), BONE)
parts[sleeve_r] = parts[hand_r] = "arm.R"
parts[sleeve_l] = parts[hand_l] = "arm.L"

# Magnifier, held in the right hand; only visible while inspecting (scale animated).
ring = finish(torus("magnifier_ring", 0.13, 0.022, (0.18, -0.6, 1.56), (math.radians(90), 0, 0)), WOOD)
lens = finish(sphere("magnifier_lens", 0.12, (0.18, -0.6, 1.56), (1, 0.12, 1)), GLASS)
handle = finish(capsule("magnifier_handle", 0.02, 0.16, (0.18, -0.52, 1.38), (math.radians(20), 0, 0)), WOOD)
for o in (ring, lens, handle):
    parts[o] = "magnifier"

# Coffee-stirrer scythe leaning against the chair.
pole = finish(capsule("scythe_pole", 0.035, 2.1, (0.86, 0.12, 1.05), (0, math.radians(-10), 0)), WOOD)
blade = finish(torus("scythe_blade", 0.3, 0.045, (0.58, 0.12, 2.04), (math.radians(90), math.radians(8), 0), arc=math.pi * 0.85), BLADE)
paddle = finish(sphere("stirrer_paddle", 0.08, (0.68, 0.12, 2.24), (1, 0.25, 1.4)), WOOD)
for o in (pole, blade, paddle):
    parts[o] = "root"


# ── rig ─────────────────────────────────────────────────────────────────────

arm_data = bpy.data.armatures.new("reaper_rig")
rig = link(bpy.data.objects.new("reaper", arm_data))
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")


def bone(name, head, tail, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head = head
    b.tail = tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b


bone("root", (0, 0, 0), (0, 0, 0.3))
bone("spine", (0, 0, 0.3), (0, 0, 1.2), "root")
bone("head", (0, 0, 1.25), (0, 0, 1.9), "spine")
# Arms point straight down from the shoulder in rest pose; rotations about local X swing them forward.
bone("arm.R", (0.3, -0.05, 1.08), (0.3, -0.05, 0.6), "spine")
bone("arm.L", (-0.3, -0.05, 1.02), (-0.3, -0.05, 0.6), "spine")
# Held up in front of the face; parented to the spine so it stays put while the arm moves.
bone("magnifier", (0.18, -0.55, 1.4), (0.18, -0.55, 1.6), "spine")
bpy.ops.object.mode_set(mode="OBJECT")

# Bake each part's modifiers (subdivision, the hood opening), tag its vertices with its bone, then merge
# everything into one mesh so the export has a single skin and few draw calls.
depsgraph = bpy.context.evaluated_depsgraph_get()
baked = []
for obj, bone_name in parts.items():
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    flat = link(bpy.data.objects.new(obj.name + "_baked", mesh))
    flat.matrix_world = obj.matrix_world
    group = flat.vertex_groups.new(name=bone_name)
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    baked.append(flat)
for obj in list(parts) + [cutter]:
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.object.select_all(action="DESELECT")
for obj in baked:
    obj.select_set(True)
bpy.context.view_layer.objects.active = baked[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "reaper_body"
body.parent = rig
mod = body.modifiers.new("rig", "ARMATURE")
mod.object = rig
bpy.context.view_layer.objects.active = rig

for pb in rig.pose.bones:
    pb.rotation_mode = "XYZ"


# ── animation ───────────────────────────────────────────────────────────────

def pose(frame, **bones):
    """bones: name=(rx, ry, rz) in degrees, or name=('scale', s)."""
    for name, value in bones.items():
        pb = rig.pose.bones[name.replace("_", ".") if name.startswith("arm") else name]
        if value and value[0] == "scale":
            pb.scale = (value[1],) * 3
            pb.keyframe_insert("scale", frame=frame)
        else:
            pb.rotation_euler = tuple(math.radians(v) for v in value)
            pb.keyframe_insert("rotation_euler", frame=frame)


REST = dict(spine=(0, 0, 0), head=(5, 0, -6), arm_R=(0, 0, 0), arm_L=(0, 0, 0), magnifier=("scale", 0.001))


def clip(name, keys, loop=False):
    """keys: list of (seconds, {bone: value}) merged over REST at every key."""
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    for seconds, overrides in keys:
        pose(round(seconds * FPS), **{**REST, **overrides})
    for fc in action.fcurves if hasattr(action, "fcurves") else []:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
    rig.animation_data.action = None
    return action


clip("idle", [(0, {}), (1.5, {"spine": (2, 0, 0), "head": (7, 0, -8)}), (3, {})], loop=True)
clip("stamp", [(0, {}), (0.22, {"arm_R": (-55, 0, 0)}), (0.3, {"arm_R": (45, 0, 0), "spine": (6, 0, 0)}), (0.7, {"arm_R": (45, 0, 0)}), (1.0, {})])
clip("gavel", [(0, {}), *[(t, {"arm_R": (-40 if i % 2 == 0 else 35, 0, 0)}) for i, t in enumerate([0.11, 0.22, 0.33, 0.44, 0.55, 0.66])], (0.9, {})])
clip("pen", [(0, {}), *[(0.08 * i, {"arm_L": (6 if i % 2 else -6, 0, 6 if i % 2 else -6), "head": (14, 0, -6)}) for i in range(1, 7)], (0.8, {})])
clip("nod", [(0, {}), (0.15, {"head": (22, 0, -6)}), (0.3, {"head": (2, 0, -6)}), (0.45, {"head": (18, 0, -6)}), (0.7, {})])
clip("reject", [(0, {}), *[(0.1 * i, {"head": (5, 0, -6 + (16 if i % 2 else -16) * (1 - i / 7))}) for i in range(1, 7)], (0.8, {})])
clip("tear", [(0, {}), (0.45, {"arm_R": (40, 0, -30), "arm_L": (-20, 0, 40), "head": (-6, 0, 0)}), (0.6, {"arm_R": (35, 0, -55), "arm_L": (-25, 0, 60)}), (1.2, {})])
clip("inspect", [(0, {}), (0.25, {"arm_R": (-10, 0, 0), "magnifier": ("scale", 1), "head": (14, 0, -4)}), (0.7, {"arm_R": (-10, 0, 0), "magnifier": ("scale", 1), "head": (14, 0, 6)}), (1.1, {"arm_R": (-10, 0, 0), "magnifier": ("scale", 1), "head": (14, 0, -6)}), (1.35, {})])
clip("yawn", [(0, {}), (0.6, {"head": (-20, 0, 0), "arm_R": (-35, 0, 0), "spine": (-4, 0, 0)}), (1.2, {"head": (-20, 0, 0), "arm_R": (-35, 0, 0)}), (1.6, {})])
clip("page", [(0, {}), (0.5, {"arm_L": (0, 0, -35), "head": (12, 0, 8)}), (1.0, {"arm_L": (0, 0, 15), "head": (12, 0, -4)}), (1.5, {})])
clip("polish", [(0, {}), *[(0.15 * i, {"arm_R": (25 + (8 if i % 2 else -8), 0, -40), "head": (4, 0, -25)}) for i in range(1, 9)], (1.5, {})])
clip("glance", [(0, {}), (0.4, {"head": (6, 0, -35)}), (1.1, {"head": (6, 0, -35)}), (1.5, {})])

# Rest pose for the bind (no action assigned).
for pb in rig.pose.bones:
    pb.rotation_euler = (0, 0, 0)
    pb.scale = (1, 1, 1)


# ── export ──────────────────────────────────────────────────────────────────

bpy.ops.object.select_all(action="DESELECT")
for obj in scene.objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_frame_range=False,
    export_skins=True,
    export_morph=False,
)
print("exported", OUT)
