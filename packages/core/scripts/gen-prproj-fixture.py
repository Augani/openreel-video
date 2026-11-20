import sys
S = 254016000000
def t(sec): return str(int(round(sec * S)))
TPF25 = str(S // 25)
TPF2997 = "8475667200"
ids = {"n": 100}
out = []
def nid():
    ids["n"] += 1
    return str(ids["n"])
def emit(s): out.append(s)

def uid(prefix, n): return f"{prefix}-0000-4000-8000-{n:012d}"

# ---- media -----------------------------------------------------------------
medias = {}
def media(key, n, path, title, video=None, audio=False, dur=None):
    u = uid("aaaaaaaa", n)
    vs = nid() if video else None
    as_ = nid() if audio else None
    medias[key] = dict(uid=u, vs=vs, as_=as_, video=video, audio=audio, dur=dur, path=path, title=title)
    return medias[key]

media("interview", 1, "/Volumes/Shoot/Day1/interview.mp4", "interview.mp4", video=(TPF2997, 1920, 1080), audio=True, dur=60)
media("broll", 2, "/Volumes/Shoot/Day1/broll.mov", "broll.mov", video=(TPF25, 3840, 2160), audio=False, dur=30)
media("music", 3, "C:\\Music\\theme song.wav", "theme song.wav", audio=True, dur=180)
media("overlay", 4, "/Volumes/Shoot/Graphics/overlay.png", "overlay.png", video=(TPF25, 1280, 720), audio=False, dur=5)

for k, m in medias.items():
    emit(f'<Media ObjectUID="{m["uid"]}" ClassID="7a78f4f1-ca6b-4fd5-a8c8-87a6a8b1c0c7" Version="31">')
    emit(f'  <ImplementationID>00000000-0000-0000-0000-000000000000</ImplementationID>')
    emit(f'  <FilePath>{m["path"]}</FilePath>')
    emit(f'  <ActualMediaFilePath>{m["path"]}</ActualMediaFilePath>')
    emit(f'  <Title>{m["title"]}</Title>')
    if m["vs"]: emit(f'  <VideoStream ObjectRef="{m["vs"]}"/>')
    if m["as_"]: emit(f'  <AudioStream ObjectRef="{m["as_"]}"/>')
    emit('</Media>')
    if m["vs"]:
        tpf, w, h = m["video"]
        emit(f'<VideoStream ObjectID="{m["vs"]}" ClassID="a2f2f1c0-1b7f-4a5c-8c55-0f2f5b9c7d11" Version="3">')
        emit(f'  <FrameRate>{tpf}</FrameRate>')
        emit(f'  <FrameRect>0,0,{w},{h}</FrameRect>')
        emit('</VideoStream>')
    if m["as_"]:
        emit(f'<AudioStream ObjectID="{m["as_"]}" ClassID="b3c3f2d1-2c80-4b6d-9d66-1a3a6c0d8e22" Version="2">')
        emit('  <SampleRate>48000</SampleRate>')
        emit('  <NumChannels>2</NumChannels>')
        emit('</AudioStream>')

# ---- master clips: clip -> source -> media ---------------------------------
masters = {}
def master(key, n, name):
    m = medias[key]
    mu = uid("bbbbbbbb", n)
    pu = uid("cccccccc", n)
    clips = []
    for kind in (["video"] if m["vs"] else []) + (["audio"] if m["as_"] else []):
        src, clip = nid(), nid()
        cls = "VideoClip" if kind == "video" else "AudioClip"
        scls = "VideoMediaSource" if kind == "video" else "AudioMediaSource"
        emit(f'<{scls} ObjectID="{src}" ClassID="e64ddf70-d1d1-4c0e-9e37-6e6aa1cbd3a6" Version="2">')
        emit('  <MediaSource Version="4">')
        emit(f'    <Media ObjectURef="{m["uid"]}"/>')
        emit(f'    <OriginalDuration>{t(m["dur"])}</OriginalDuration>')
        emit('  </MediaSource>')
        emit(f'</{scls}>')
        emit(f'<{cls} ObjectID="{clip}" ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec" Version="3">')
        emit('  <Clip Version="18">')
        emit(f'    <Source ObjectRef="{src}"/>')
        emit('    <InPoint>0</InPoint>')
        emit(f'    <OutPoint>{t(m["dur"])}</OutPoint>')
        emit('  </Clip>')
        if kind == "video": emit(f'  <FrameRect>0,0,{m["video"][1]},{m["video"][2]}</FrameRect>')
        emit(f'</{cls}>')
        clips.append((kind, clip, src))
    emit(f'<MasterClip ObjectUID="{mu}" ClassID="fb11c33a-b0a3-4d5f-9a6a-8b1b8a1d0a5a" Version="12">')
    emit('  <Clips Version="1">')
    for i, (_, c, _) in enumerate(clips): emit(f'    <Clip Index="{i}" ObjectRef="{c}"/>')
    emit('  </Clips>')
    emit(f'  <Name>{name}</Name>')
    emit('</MasterClip>')
    emit(f'<ClipProjectItem ObjectUID="{pu}" ClassID="cb4e0ed7-aca1-4f8a-b5f5-0ca8a9a1b3f7" Version="1">')
    emit(f'  <ProjectItem Version="1"><Name>{name}</Name></ProjectItem>')
    emit(f'  <MasterClip ObjectURef="{mu}"/>')
    emit('</ClipProjectItem>')
    masters[key] = dict(master=mu, item=pu, clips={k: (c, s) for k, c, s in clips})

master("interview", 1, "interview.mp4")
master("broll", 2, "broll.mov")
master("music", 3, "theme song.wav")
master("overlay", 4, "overlay.png")

# ---- bins -------------------------------------------------------------------
def bin_(n, name, children):
    u = uid("dddddddd", n)
    emit(f'<BinProjectItem ObjectUID="{u}" ClassID="dbfd21a6-b6d3-4b6a-a4a0-0e8d6c6b1d33" Version="1">')
    emit('  <ProjectItemContainer Version="1"><Items Version="1">')
    for i, c in enumerate(children): emit(f'    <Item Index="{i}" ObjectURef="{c}"/>')
    emit('  </Items></ProjectItemContainer>')
    emit(f'  <ProjectItem Version="1"><Name>{name}</Name></ProjectItem>')
    emit('</BinProjectItem>')
    return u

graphics = bin_(1, "Graphics", [masters["overlay"]["item"]])
footage = bin_(2, "Footage", [masters["interview"]["item"], masters["broll"]["item"], graphics])
audio = bin_(3, "Audio", [masters["music"]["item"]])

# ---- sequences ---------------------------------------------------------------
seq_objs = {}
def component(match, display, params):
    pids = []
    for name, cur, extra in params:
        pid = nid()
        pids.append(pid)
        emit(f'<VideoComponentParam ObjectID="{pid}" ClassID="a8f0a3e5-57a1-4e8e-8a3a-9e0f8f2a9a44" Version="7">')
        emit(f'  <Name>{name}</Name>')
        emit(f'  <CurrentValue>{cur}</CurrentValue>')
        if extra: emit(f'  {extra}')
        emit('</VideoComponentParam>')
    cid = nid()
    emit(f'<VideoFilterComponent ObjectID="{cid}" ClassID="0970b8ba-3d9f-4c4a-8a3c-3a64cf6a7b55" Version="9">')
    emit(f'  <Component Version="7"><Params Version="1">')
    for i, p in enumerate(pids): emit(f'    <Param Index="{i}" ObjectRef="{p}"/>')
    emit('  </Params></Component>')
    emit(f'  <MatchName>{match}</MatchName>')
    emit(f'  <DisplayName>{display}</DisplayName>')
    emit('</VideoFilterComponent>')
    return cid

def chain(comps):
    cid = nid()
    emit(f'<VideoComponentChain ObjectID="{cid}" ClassID="0d6e4a9d-4b5c-4d0e-8f9a-6a7b8c9d0e1f" Version="3">')
    emit('  <ComponentChain Version="3"><Components Version="1">')
    for i, c in enumerate(comps): emit(f'    <Component Index="{i}" ObjectRef="{c}"/>')
    emit('  </Components></ComponentChain>')
    emit('</VideoComponentChain>')
    return cid

MOTION_DEFAULT = lambda: component("AE.ADBE Motion", "Motion", [("Position", "0.5:0.5", None), ("Scale", "100", None), ("Rotation", "0", None)])
OPACITY = lambda v: component("AE.ADBE Opacity", "Opacity", [("Opacity", str(v), None)])

def item(kind, name, mediakey, start, end, inp, outp, comps=None, disabled=False, speed=None, reverse=False, nested_seq=None):
    """Return the track item ObjectID."""
    m = masters.get(mediakey)
    if nested_seq:
        src, clip = nid(), nid()
        emit(f'<VideoSequenceSource ObjectID="{src}" ClassID="1c9a8d37-0e7a-4d6f-b0c3-2f4e5d6c7b88" Version="1">')
        emit(f'  <Sequence ObjectURef="{nested_seq}"/>')
        emit('</VideoSequenceSource>')
        emit(f'<VideoClip ObjectID="{clip}" ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec" Version="3">')
        emit(f'  <Clip Version="18"><Source ObjectRef="{src}"/><InPoint>{t(inp)}</InPoint><OutPoint>{t(outp)}</OutPoint></Clip>')
        emit('</VideoClip>')
    else:
        base_clip, src = m["clips"][kind]
        clip = nid()
        cls = "VideoClip" if kind == "video" else "AudioClip"
        emit(f'<{cls} ObjectID="{clip}" ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec" Version="3">')
        emit(f'  <Clip Version="18"><Source ObjectRef="{src}"/><InPoint>{t(inp)}</InPoint><OutPoint>{t(outp)}</OutPoint></Clip>')
        emit(f'  <PlaybackSpeed>{speed if speed else 1}</PlaybackSpeed>' if False else '')
        emit(f'</{cls}>')
    sub = nid()
    emit(f'<SubClip ObjectID="{sub}" ClassID="e0c6bd4a-5f55-4a76-9bd8-6f0d3a1c2e99" Version="5">')
    emit(f'  <Clip ObjectRef="{clip}"/>')
    if m: emit(f'  <MasterClip ObjectURef="{m["master"]}"/>')
    emit(f'  <Name>{name}</Name>')
    emit('</SubClip>')
    comp_chain = chain(comps or []) if comps is not None else None
    iid = nid()
    cls = "VideoClipTrackItem" if kind == "video" else "AudioClipTrackItem"
    emit(f'<{cls} ObjectID="{iid}" ClassID="368b0d13-5e1c-4b0f-a9a2-5d7f3e0c1b77" Version="8">')
    emit('  <ClipTrackItem Version="8">')
    if comp_chain: emit(f'    <ComponentOwner Version="1"><Components ObjectRef="{comp_chain}"/></ComponentOwner>')
    emit(f'    <SubClip ObjectRef="{sub}"/>')
    emit('    <TrackItem Version="4">')
    emit(f'      <Start>{t(start)}</Start>')
    emit(f'      <End>{t(end)}</End>')
    if disabled: emit('      <Disabled>true</Disabled>')
    emit('    </TrackItem>')
    if speed is not None: emit(f'    <Speed>{speed}</Speed>')
    if reverse: emit('    <PlayBackwards>true</PlayBackwards>')
    emit('  </ClipTrackItem>')
    emit(f'</{cls}>')
    return iid

def transition(name, start, end):
    comp = component("AE.ADBE Cross Dissolve" if name == "Cross Dissolve" else "AE.ADBE Cross Zoom", name, [])
    chn = chain([comp])
    iid = nid()
    emit(f'<VideoTransitionItem ObjectID="{iid}" ClassID="4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d" Version="3">')
    emit('  <TransitionTrackItem Version="3">')
    emit(f'    <ComponentOwner Version="1"><Components ObjectRef="{chn}"/></ComponentOwner>')
    emit(f'    <TrackItem Version="4"><Start>{t(start)}</Start><End>{t(end)}</End></TrackItem>')
    emit('  </TransitionTrackItem>')
    emit(f'  <TransitionName>{name}</TransitionName>')
    emit('</VideoTransitionItem>')
    return iid

track_uid = {"n": 0}
def track(kind, idx, items, transitions=(), extra=""):
    track_uid["n"] += 1
    u = uid("eeeeeeee", track_uid["n"] + (0 if kind == "video" else 500))
    cls = "VideoClipTrack" if kind == "video" else "AudioClipTrack"
    emit(f'<{cls} ObjectUID="{u}" ClassID="e2b8bcd1-8f2d-4a6e-b1d8-7a1f2c3d4e55" Version="5">')
    emit('  <ClipTrack Version="3">')
    emit(f'    <Track Version="4"><ID>{idx + 1}</ID><Index>{idx}</Index>{extra}</Track>')
    emit('    <ClipItems Version="3"><TrackItems Version="1">')
    for i, it in enumerate(items): emit(f'      <TrackItem Index="{i}" ObjectRef="{it}"/>')
    emit('    </TrackItems></ClipItems>')
    if transitions:
        emit('    <TransitionItems Version="1"><TrackItems Version="1">')
        for i, it in enumerate(transitions): emit(f'      <TrackItem Index="{i}" ObjectRef="{it}"/>')
        emit('    </TrackItems></TransitionItems>')
    emit('  </ClipTrack>')
    emit(f'</{cls}>')
    return u

def group(kind, track_uids, tpf=TPF25, w=1920, h=1080):
    gid = nid()
    cls = "VideoTrackGroup" if kind == "video" else "AudioTrackGroup"
    emit(f'<{cls} ObjectID="{gid}" ClassID="f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b" Version="9">')
    emit('  <TrackGroup Version="1">')
    emit('    <Tracks Version="1">')
    for i, u in enumerate(track_uids): emit(f'      <Track Index="{i}" ObjectURef="{u}"/>')
    emit('    </Tracks>')
    if kind == "video":
        emit(f'    <FrameRect>0,0,{w},{h}</FrameRect>')
    emit(f'    <FrameRate>{tpf}</FrameRate>')
    emit('  </TrackGroup>')
    emit(f'</{cls}>')
    return gid

def marker(name, at, dur, comment, typ):
    mid = nid()
    emit(f'<Marker ObjectID="{mid}" ClassID="5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e" Version="4">')
    emit(f'  <Name>{name}</Name><Comment>{comment}</Comment><Type>{typ}</Type>')
    emit(f'  <Start>{t(at)}</Start><Duration>{t(dur)}</Duration>')
    emit('</Marker>')
    return mid

def markers(ids):
    mid = nid()
    emit(f'<Markers ObjectID="{mid}" ClassID="6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f" Version="3">')
    emit('  <Markers Version="1">')
    for i, m in enumerate(ids): emit(f'    <Marker Index="{i}" ObjectRef="{m}"/>')
    emit('  </Markers>')
    emit('</Markers>')
    return mid

def sequence(n, name, vgroup, agroup, mk=None):
    u = uid("ffffffff", n)
    emit(f'<Sequence ObjectUID="{u}" ClassID="6a15d903-8739-11d5-af2d-9b7855ad8974" Version="1">')
    emit('  <Node Version="1"><Properties Version="1"/></Node>')
    emit('  <TrackGroups Version="1">')
    emit(f'    <TrackGroup Version="1" Index="0"><First>0</First><Second ObjectRef="{vgroup}"/></TrackGroup>')
    if agroup: emit(f'    <TrackGroup Version="1" Index="1"><First>1</First><Second ObjectRef="{agroup}"/></TrackGroup>')
    emit('  </TrackGroups>')
    if mk: emit(f'  <Markers ObjectRef="{mk}"/>')
    emit(f'  <Name>{name}</Name>')
    emit('</Sequence>')
    return u

# Nest sequence: one clip of broll
nest_item = item("video", "broll.mov", "broll", 0, 3, 1, 4, comps=[MOTION_DEFAULT()])
nest_track = track("video", 0, [nest_item])
nest_group = group("video", [nest_track])
nest_seq = sequence(3, "Lower Third Nest", nest_group, None)

# Alt cut
alt_item = item("video", "interview.mp4", "interview", 0, 2, 0, 2)
alt_track = track("video", 0, [alt_item])
alt_group = group("video", [alt_track], tpf=TPF2997)
alt_seq = sequence(2, "Alt Cut", alt_group, None)

# Main cut
v1_a = item("video", "interview.mp4", "interview", 0, 5, 2, 7, comps=[MOTION_DEFAULT(), OPACITY(100)])
v1_b = item("video", "broll.mov", "broll", 5, 9, 0, 8, comps=[
    component("AE.ADBE Motion", "Motion", [("Position", "0.75:0.25", None), ("Scale", "50", None), ("Rotation", "0", None)]),
    OPACITY(100)])
v1_c = item("video", "interview.mp4", "interview", 9, 11, 0, 2, disabled=True)
tr = transition("Cross Dissolve", 4.5, 5.5)
v1 = track("video", 0, [v1_a, v1_b, v1_c], transitions=[tr])

v2_a = item("video", "overlay.png", "overlay", 1, 4, 0, 3, comps=[
    MOTION_DEFAULT(), OPACITY(50),
    component("AE.ADBE Gaussian Blur 2", "Gaussian Blur", [("Blurriness", "25", None)])])
v2_b = item("video", "Lower Third Nest", None, 6, 8, 0, 2, nested_seq=nest_seq)
v2 = track("video", 1, [v2_a, v2_b])

a1_a = item("audio", "interview.mp4", "interview", 0, 5, 2, 7, comps=[component("AC.ADBE Volume", "Volume", [("Level", "1", None)])])
a1 = track("audio", 0, [a1_a])
a2_a = item("audio", "theme song.wav", "music", 0, 8, 0, 8, comps=[component("AC.ADBE Volume", "Volume", [("Level", "0.5", None)])])
a2_b = item("audio", "theme song.wav", "music", 8, 10, 20, 22, reverse=True)
a2 = track("audio", 1, [a2_a, a2_b], extra="<IsMuted>false</IsMuted><IsTargeted>true</IsTargeted>")

vg = group("video", [v1, v2])
ag = group("audio", [a1, a2])
mk = markers([marker("Intro", 1, 0, "start here", "Comment"), marker("Chapter 2", 6, 2, "", "Chapter")])
main_seq = sequence(1, "Main Cut", vg, ag, mk)

root = nid()
emit(f'<RootProjectItem ObjectUID="{uid("99999999", 1)}" ClassID="1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7" Version="1">')
emit('  <ProjectItemContainer Version="1"><Items Version="1">')
for i, c in enumerate([footage, audio]): emit(f'    <Item Index="{i}" ObjectURef="{c}"/>')
emit('  </Items></ProjectItemContainer>')
emit('  <ProjectItem Version="1"><Name>Root</Name></ProjectItem>')
emit('</RootProjectItem>')

body = "\n".join(l for l in out if l.strip())
xml = '<?xml version="1.0" encoding="UTF-8" ?>\n<PremiereData Version="3">\n' + body + '\n</PremiereData>\n'
open(sys.argv[1], "w").write(xml)
