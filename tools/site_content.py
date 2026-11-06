# The words on the website's product pages (10.3): every app, every feature, the sound plans and the FAQ.
# tools/make-site.py builds the pages from this. Sources: the release notes (release-notes/10.*.md and before), the
# manuals (server/public/apps/*.html) and docs/. Keep it in plain words: what a person can do, not how it's built.

SUPPORT_EMAIL = "support@motionaudio.org"   # (the server's SUPPORT_EMAIL default; the Help page shows it)

PLATFORMS = {
    "pedal": "Built in to the Central Pedal",
    "mac": "Mac", "win": "Windows", "linux": "Linux", "ios": "iPhone and iPad", "android": "Android", "web": "Web browser",
}

APPS = [
    {
        "slug": "pedal", "name": "Central Pedal", "icon": "central-pedal", "manual": "/apps/central-pedal.html",
        "tag": "The pedal at the worship leader's feet",
        "lede": "Pads, multitracks, chord charts, lyrics, a looper and a guitar and keys rig, in one floor unit with 12 footswitches, knobs, a touch screen and two HDMI ports. We build it, test it and ship it ready to play.",
        "who": ["Worship leader", "Keys player"], "platforms": ["pedal"],
        "buy": {"add": "pedal", "label": "Add the pedal to cart", "note": "One-time. Its software is on it already and updates itself; it needs no key."},
        "shot": "pedal-live", "shots": ["pedal-live", "pedal-pads"],
        "groups": [
            ("On stage: LIVE", [
                ("The song you're on, and what's next", "Key, BPM, time left and the next song, big enough to read from where you stand."),
                ("Sections you can jump to", "Tap a section, or step with a footswitch. Vamp repeats the section; Safe stop fades out on the bar."),
                ("Next song crossfades", "The pad moves into the next song's key and tempo without a gap."),
                ("Lock for service", "One button keeps fingers off the settings during the service."),
            ]),
            ("Tracks", [
                ("Multitracks with click and spoken cues", "Play your stems with a click and cues like \"Verse\", \"Chorus\" and \"Build\". Mute or turn down any stem live."),
                ("Your own songs", "Add MP3s or WAVs from a USB stick, from Central Pedal Control, or from Central Tracks."),
                ("Change key and tempo", "Every song can play in another key or at another tempo, and the chart follows."),
                ("Tracks or pads, or both", "Tracks play without pads, and pads play without tracks."),
            ]),
            ("Pads and effects", [
                ("Pads in every key", "82 pads in all 12 keys with Central Pads and Central Pads Extra: warm, airy, choir, strings, shimmer and more, and six that move in time with the song."),
                ("Morph, freeze and swell", "Blend between two pads with the expression pedal, freeze the sound, or swell into the next section."),
                ("Effects on every stem and pad", "EQ, compressor, reverb and delay come free; the plans add better ones. Plugins you make yourself play here too."),
                ("A volume for every pad", "A slider on each pad, plus bus levels and mutes from the footswitches."),
            ]),
            ("Looper and instrument", [
                ("A three-loop looper", "Record, overdub and stop three loops, from the 3.5\" screen, the HDMI screen or Central Pedal Control."),
                ("A guitar and keys rig", "Plug in a guitar or a USB keyboard and play through pedal boards and the keys sounds."),
                ("Footswitches, knobs and MIDI", "12 buttons, 6 knobs and 2 sliders do whatever you set: tabs, moving around the screen, bus levels, any action."),
            ]),
            ("Screens and sound", [
                ("A 3.5\" touch screen", "Pads, tracks, effects, setlists, scenes and the looper, right at your feet. It shows mouse clicks from HDMI too."),
                ("Two HDMI ports", "Each port shows its own choice: the full app, the lyrics for the room, or the chart."),
                ("Outputs your way", "Headphone jack on 1-2, a DAC board on 3-4 and a USB audio interface after that. Each bus goes where you want."),
                ("Updates itself", "It looks every few hours and installs in a quiet minute, never while something plays. Updates from USB work too."),
            ]),
        ],
    },
    {
        "slug": "pedal-control", "name": "Central Pedal Control", "icon": "central-pedal-control", "manual": "/apps/central-pedal-control.html",
        "tag": "Get the pedal ready from home",
        "lede": "Build setlists, add songs and tracks, set up pads, effects and the instrument, and choose what every button does. Then press Upload and it's all on the pedal.",
        "who": ["Worship leader", "Whoever gets the songs ready"], "platforms": ["mac", "win", "linux", "ios", "android"],
        "buy": {"add": "pedal-control", "label": "Add a Central Pedal Control key", "note": "Yours for good, on two devices, with every update we make. Every church pack includes one."},
        "shot": "pc-tracks", "shots": ["pc-live", "pc-tracks", "pc-pads", "pc-configure", "pc-io"],
        "groups": [
            ("Songs and setlists", [
                ("+ Add songs", "Your own MP3s or WAVs, a multitrack, a Prime track or anything from Central Tracks."),
                ("Sections and cues", "Mark a song's sections and set its click, count-in and spoken cues."),
                ("A stem splitter", "Split a stereo song into drums, bass, keys and vocals to use as stems."),
                ("Setlists", "Arrange the setlist, set each song's key and tempo, and open Planning Center plans."),
            ]),
            ("Sound", [
                ("Pads and effects", "Pick each pad's sound, key and fade, and add effects on each stem, pad and bus."),
                ("The instrument", "Set up the sound the pedal plays from a USB keyboard or a guitar."),
                ("Outputs", "Pick where the pedal's audio goes: the desk, the in-ears, or both."),
            ]),
            ("Controls", [
                ("Configure and Learn", "Choose what every button, knob and pedal does, with a press and a hold. Wire your own and press Learn."),
                ("LIVE, mirrored", "LIVE shows exactly what the pedal's buttons do during the service."),
                ("Saved setups", "Save the whole pedal's setup and bring it back with one tap."),
            ]),
            ("Upload and Download", [
                ("Upload", "Send everything to the pedal over the church Wi-Fi."),
                ("Download", "Bring the pedal's setup back to your computer, to edit or keep."),
                ("Works everywhere", "Mac, Windows, Linux, iPhone, iPad and Android."),
            ]),
        ],
    },
    {
        "slug": "control", "name": "Central Control", "icon": "central-control", "manual": "/apps/central-control.html",
        "tag": "The desk runs the whole service",
        "lede": "Lights, lyrics, slides, cameras, the stream, in-ears, the mix and the run sheet, from the computers at the desk. Each computer picks its jobs, and they share the work.",
        "who": ["Main admin", "Admin", "Production volunteer"], "platforms": ["mac", "win", "linux"],
        "buy": {"add": "admin", "label": "Add a Central Control key", "note": "One computer per key, with ten releases of updates. Every church pack includes several."},
        "shot": "cc-lights", "shots": ["cc-service", "cc-lights", "cc-slides", "cc-lyrics", "cc-mix", "cc-inears", "cc-video", "cc-devices"],
        "groups": [
            ("Running the service", [
                ("Run sheets", "Answer a few questions and it builds a timed run sheet. Next fires the song, lyrics, lights, slides, camera and stream together."),
                ("Pre-service check", "Every pedal, computer, key, output, mic, light, camera, screen and the stream, green, amber or red with a plain fix. It runs 30 minutes before service."),
                ("Jobs per computer", "Lyrics, lights, cameras, in-ears, tracks, the stream mix or slides: each computer picks its jobs at setup."),
                ("Talk", "Hold Talk to speak into everyone's in-ears; a quick tap keeps it on."),
                ("Search everything", "Ctrl+K / ⌘K finds songs, setlists, settings, presets, decks and actions like \"Start stream\"."),
            ]),
            ("Lights", [
                ("Your stage in 3D", "Every light where it hangs and where it points, with haze, trusses, screens and projectors that show what the real screens show."),
                ("2,272 real lights", "Pick yours by maker and model, or make your own profile."),
                ("Program lights", "Colour, brightness, position, zoom, gobo, strobe and effects for each light, all live."),
                ("Auto lights and the AI", "The lights follow the song's sections by themselves; type what you want and the AI helper builds it."),
                ("Build my stage", "A few questions build the stage, the room and the seats. Or trace a floor plan or photo."),
                ("Your room and seats", "Draw the auditorium and see how the light falls on the congregation."),
                ("Quick slots, setlists and simulate", "10 quick slots, the worship leader's setlist, and a simulation that plays it without the real lights."),
            ]),
            ("Lyrics, slides and video", [
                ("Lyrics that follow the track", "With 61 backgrounds, moving and still, per song or per section, and 118 with Central Utility."),
                ("The band's screen", "A confidence monitor: current lines in yellow, next in white, with chords, a clock and booth messages."),
                ("A slide designer", "Themes, templates, transitions and lower thirds. Import pictures, PDFs and PowerPoint."),
                ("Scripture in seconds", "Type \"John 3:16\" and it's slides and a stream caption. Four Bibles built in."),
                ("Cameras and the stream", "Switch cameras for the room and the stream, with slides and lyrics on top. RTMP, SRT and NDI."),
            ]),
            ("Sound and in-ears", [
                ("The mix", "The pedal's tracks arrive as channels with meters and faders. Record the whole service with one button."),
                ("Up to 64 in-ear mixes", "Each musician picks a mix and sets their own levels."),
                ("I/O", "What comes in, what this computer does with it, and what goes out, on one page."),
            ]),
            ("After the service", [
                ("Automatic shorts", "The built-in AI picks the strongest sermon moments and worship high points and makes vertical clips with captions. You review and post."),
                ("Planning Center and CCLI", "Plans become setlists; the copyright line goes on screen and the CCLI report fills itself in."),
            ]),
        ],
    },
    {
        "slug": "usage", "name": "Central Usage", "icon": "central-usage", "manual": "/apps/central-usage.html",
        "tag": "Each musician's chart, sound and mix",
        "lede": "Every musician and singer gets their own chord chart, the lyrics, their instrument sound and their own in-ear mix, at church and at home.",
        "who": ["Musician", "Singer"], "platforms": ["mac", "win", "linux", "ios", "android"],
        "buy": {"add": "user", "label": "Add a Central Usage key", "note": "Two devices per key, so a player can have one at church and one at home."},
        "shot": "cu-chart", "shots": ["cu-chart", "cu-lyrics", "cu-inears", "cu-instrument"],
        "groups": [
            ("Charts and lyrics", [
                ("A chart that follows the song", "It highlights where the band is, in your key, your clef and your instrument's part."),
                ("Chart types", "Chords over words, Nashville numbers, lead sheet or notation."),
                ("Lyrics for singers", "The words move with the song, with the next lines coming up."),
            ]),
            ("Your sound", [
                ("Your own in-ear mix", "Set your own levels of the tracks and the band from your own device."),
                ("An instrument", "Plug in a keyboard or guitar and play through 136 built-in sounds; the plans add more."),
                ("Your own plugins", "On a computer, bring the VST3, Audio Units, CLAP and LV2 plugins you already own."),
            ]),
            ("Studio and controls", [
                ("Studio", "Record ideas and loops on the same engine as Central Production, with Open in Central Production."),
                ("Learn any control", "MIDI pedals, footswitches, keyboards and Stream Deck."),
                ("Two users on one device", "User 1 and User 2 share a computer, each with their own part and mix."),
                ("Your colours", "Every colour in the app can be changed."),
            ]),
        ],
    },
    {
        "slug": "services", "name": "Central Services", "icon": "central-services", "manual": "/apps/central-services.html",
        "tag": "Who's serving, sorted",
        "lede": "The schedule for the whole church: services, who's asked, who said yes, who's away and what's being played, on everyone's phone.",
        "who": ["Everyone in the church", "Schedulers"], "platforms": ["web", "mac", "win", "linux", "ios", "android"],
        "buy": {"add": "services-slot", "label": "Add a Central Services slot", "note": "One per person on your teams, paid once. Every church pack includes slots."},
        "shot": "cs-schedule", "shots": ["cs-schedule", "cs-request", "cs-teams"],
        "groups": [
            ("Scheduling", [
                ("Services and requests", "Schedulers make services and ask people from the worship and production teams. They get an email and tap yes or no."),
                ("My requests", "Each person sees what's asked of them, with a note if they can't make it."),
                ("Away", "People mark the dates they're away, and schedulers see it."),
            ]),
            ("Teams and setlists", [
                ("Teams", "Who serves where, and how many of your church's slots are used."),
                ("Setlists", "Setlists made in the apps show up here, with keys and tracks."),
                ("Slots, not keys", "Take someone off a team and their slot is free for the next person."),
            ]),
        ],
    },
    {
        "slug": "production", "name": "Central Production", "icon": "central-production", "manual": None,
        "tag": "Make tracks, pads, sounds and plugins",
        "lede": "A free studio and sampler. Make tracks, loops, samples, pads, instruments, plugins and pedal boards, then put them in your own apps or sell them on Make & sell.",
        "who": ["Anyone making sounds", "Worship leaders", "Creators"], "platforms": ["mac", "win", "linux", "web"],
        "buy": {"free": True, "label": "Open in your browser", "href": "/production/", "note": "Free. The sound plans unlock the better sounds inside it."},
        "shot": "production", "shots": ["production"],
        "groups": [
            ("Recording and editing", [
                ("Start from what you're making", "File → New project asks: a track, loop, sample, pad, instrument, plugin or pedal board."),
                ("Multitrack recording", "Count-in, punch in and out, and loop takes, with your interface's inputs per track and latency measuring."),
                ("Tempo and time signature", "Changes anywhere in the song; loops follow your song's tempo and key."),
                ("Mixer and automation", "Sends, buses, automation, a piano roll and a drum grid with quantize and humanize."),
            ]),
            ("Plugins", [
                ("Real VST3 and CLAP plugins", "They play live on every track as the song plays, and a knob you turn is heard in about a fifth of a second. Freezing a track is there to save power."),
                ("Play a keyboard through them", "Notes from a MIDI keyboard go through the track's plugins, with only a few milliseconds of delay."),
                ("Delays in time", "Every delay can follow the song's tempo, tempo changes included: pick a note, from a whole note to a 1/32, dotted or triplet."),
                ("Make your own plugins", "Drag blocks (filter, delay, reverb, drive, chorus, compressor, pitch, LFO, knobs) and wire them up, or write code."),
                ("They play everywhere", "Plugins you make play in every app: the pedal, Central Control, Central Usage, the website and Production."),
            ]),
            ("Getting your work out", [
                ("Export", "WAV, MP3, stems, or SF2/SFZ instruments, with every plugin's automation in the sound."),
                ("Install into my apps", "Puts what you made into Central Control and Central Usage on this computer."),
                ("Publish", "Send it to Make & sell or Central Tracks, and get paid when people use it."),
                ("Saved to your account", "The app and the website open the same projects."),
            ]),
        ],
    },
]

# who needs which app: (row label, then a mark for each app in APPS order). "yes" / "some" / "".
COMPARE = [
    ("Who uses it", ["Worship leader or keys", "Whoever readies songs", "Main admin and admins", "Musicians and singers", "Everyone", "Anyone making sounds"]),
    ("Plays pads and tracks live", ["yes", "", "yes", "", "", ""]),
    ("Builds setlists and songs", ["yes", "yes", "yes", "", "some", "yes"]),
    ("Chord charts and lyrics", ["yes", "", "yes", "yes", "", ""]),
    ("Lights, slides, cameras and stream", ["", "", "yes", "", "", ""]),
    ("In-ear mixes", ["some", "", "yes", "yes", "", ""]),
    ("An instrument sound", ["yes", "yes", "yes", "yes", "", "yes"]),
    ("Scheduling the team", ["", "", "some", "", "yes", ""]),
    ("Make tracks, pads and plugins", ["", "", "", "some", "", "yes"]),
    ("How you get it", ["Buy the pedal", "P key (in every pack)", "A key (in every pack)", "U key (in every pack)", "Slots (in every pack)", "Free"]),
]

# the sound plans (prices come from the server's /config; these are the words)
PLANS = [
    {"id": "keys", "name": "Central Keys", "tag": "Pianos, organs, mallets, pads and synths",
     "lede": "Two grand pianos, an upright and FM pianos; pipe, quiet and positive organs; vibraphone, marimba and bells; fifteen stereo pads with their own character, and ten synths made by us. With Central Pads.",
     "highlights": ["Steinway B and Kawai grands, with soft versions that are really soft", "Sunday Pad, Ember Pad and Selah Strings: worship pads made from real recordings", "Ten synths, each its own kind: leads, brass, super saw, string machine, bass, pluck, FM bells", "Worship-ready presets for every sound"],
     "kinds": ["preset", "sound"]},
    {"id": "instrument", "name": "Central Instrument", "tag": "Bass, guitar, strings, brass, drums and loops",
     "lede": "Instrument sounds beyond keys, for every musician: basses, guitars, strings, brass, woodwinds and drum kits, plus 20 drum grooves and 8 ambient loops in every key. With Central Pads.",
     "highlights": ["Real basses and guitars", "Orchestral strings and brass", "20 drum grooves, from gospel shuffle to 6/8 Celtic toms", "Ambient loops in all 12 keys: felt piano, guitar swells, cello drone, choir air, harp rain"],
     "kinds": ["preset", "sound", "loops", "loop"]},
    {"id": "pads", "name": "Central Pads", "tag": "Pads in every key for the pad pedal",
     "lede": "82 pads in all 12 keys: 41 in Central Pads, and 35 more plus six moving pads in Central Pads Extra. Every one is in real stereo and loops without a seam, with swells, risers and transitions. Included with every other plan.",
     "highlights": ["Sunday Keys: the warm, airy worship pad", "Pads made from real piano, strings, harp and organ recordings", "Six moving pads that pulse in time with the song", "Swells, risers, downlifters and an arrival hit in every key", "Ambient loops and a room bed for between songs"],
     "kinds": ["pad", "loop", "loops", "sound"]},
    {"id": "plugins", "name": "Central Plugins", "tag": "Better effects on every track, pad and bus",
     "lede": "32 plugins: EQ, compressors, reverbs, delays and more for every stem, every pad, both buses and the mixer's channels, in every app. A basic one of each kind comes free; the plan gives you the better ones. With Central Pads.",
     "highlights": ["Studio EQ, compressor, limiter and de-esser", "Halls, plates and shimmer reverbs", "Delays that follow the song's tempo", "Works in Central Control, Central Usage and on the pedal"],
     "kinds": ["preset", "sound"]},
    {"id": "pedals", "name": "Central Pedals", "tag": "Guitar pedals and amp cabinets",
     "lede": "Guitar pedals for anything with a 1/4\" or 1/8\" input, including 55 new pedals of our own, and 68 ready-made boards, with real cabinet impulse responses for the amp sound. With Central Pads.",
     "highlights": ["Drives, fuzzes, modulation and ambient pedals", "28 cabinet and room impulse responses", "68 ready-made boards, five of them amps with cabinets", "Play through it on the pedal or in Central Usage"],
     "kinds": ["ir"]},
    {"id": "utility", "name": "Central Utility", "tag": "Backgrounds, slide themes, clicks and looks",
     "lede": "118 seasonal and Christian backgrounds with 51 matching slide themes and lower thirds, 14 click sounds, 24 lighting looks, countdowns and stream overlays. Included in All plans and every church bundle.",
     "highlights": ["Advent, Christmas, Easter, Pentecost and every Sunday", "A \"This Sunday\" suggestion that knows the church year", "14 click sounds, each with its own accent", "24 lighting looks, countdowns and stream overlays"],
     "kinds": []},
]

TRACKS = {"id": "tracks", "name": "Central Tracks Unlimited", "tag": "Every track in the library, every month",
          "lede": "Pads, multitracks, Prime tracks and our own arrangements of 20 hymns, plus other teams' sounds, pedal boards and clicks. Everything lands in your setlist with its chart and lyrics."}

# the FAQ on the Pricing page
PRICING_FAQ = [
    ("Do I pay once or every year?", "Church packs, the pedal and the app keys are paid once. Sound plans and Central Utility are yearly, and Central Tracks Unlimited is monthly. Every price includes tax."),
    ("What's in a church pack?", "A main admin and admins (Central Control keys), users (Central Usage keys), a Central Pedal Control key and Central Services slots for your team. The pedal is separate, so you can start with what you already have."),
    ("Which sound plan do I need?", "Keys players: Central Keys. Other musicians: Central Instrument. The pad pedal: Central Pads (it comes with every other plan). Better effects: Central Plugins. Guitarists: Central Pedals. Lyrics backgrounds and slide themes: Central Utility. The helper above picks for you."),
    ("How many devices does a sound plan work on?", "One package key works on three of your devices at once, each a different app: for example Central Usage, Central Control and your pedal."),
    ("What does a church bundle give us?", "A package key with every sound plan, Central Pads and Central Utility for each person, for a year. You hand them out on the Teams page and can move one to someone else at any time."),
    ("Do the apps stop working if we don't renew?", "No. Keys you bought keep working. Central Control keys include ten releases of updates; renew for $20 whenever you like. Sound plans keep their sounds working while the plan is active. If one ends during a service, whatever is playing finishes the song first."),
    ("Can we try it first?", "Yes. Type a trial code in the cart, or use the demo church's keys from the Help Center to try every app."),
    ("What about refunds?", "See our refund policy. In short: tell us within 30 days if something isn't right and we'll make it right."),
]

# the Help page's FAQ: (group, [(question, answer)]) - written in Sam's voice (docs/VOICE.md)
HELP_FAQ = [
    ("Getting started", [
        ("Which apps do I need?", "Most churches use Central Control at the desk, Central Usage for the musicians, Central Services for the schedule and Central Pedal Control to get the pedal ready. A church pack has all four. Add the Central Pedal if you want pads and tracks on the floor. Apps → Compare goes through it app by app."),
        ("How do I set up the pedal?", "Plug in the power and your headphones or the desk. Then join the Wi-Fi called \"Central Pedal Setup\" on your phone and the setup page walks you through getting it on your church's Wi-Fi. After that, build a setlist in Central Pedal Control and press Upload. The setup guide in the Help Center has every step."),
        ("How do the apps find each other?", "On the same network they find each other by themselves. If your network keeps devices apart, type the pedal's address into Connect. You'll find it under Settings → About & power on the pedal."),
    ]),
    ("Keys and accounts", [
        ("Where are my keys?", "Under Account → My products. Every key you or your church owns is there, with the devices it's on and a Copy button. We emailed them to you as well."),
        ("How do I move a key to a new computer?", "On Account → My products, press Release next to the old device, then type the key into the app on the new one. A Central Control key is for one computer. Central Usage and Central Pedal Control keys work on two devices."),
        ("Can a sound plan go on more than one device?", "Yes, on three of your devices at once, as long as each is a different app. Central Usage, Central Control and your pedal would work. Three copies of Central Usage wouldn't."),
        ("How do renewals work?", "Central Control and Central Usage keys get ten releases of updates from when you buy them, so buying at 10.4 covers you up to 11.4. Renewing is $20 and adds ten more. If you don't renew, the apps keep working. They just stop updating. Sound plans and Central Utility renew every year and Central Tracks Unlimited every month, until you cancel."),
    ]),
    ("Plans and billing", [
        ("What's in each sound plan?", "Central Keys has the pianos, organs, mallets, pads and synths. Central Instrument has basses, guitars, strings, brass, drums and loops. Central Pads is 82 pads in every key. Central Plugins adds 32 better effects, and Central Pedals has 55 pedals, amp cabinets and 68 ready-made boards. Every plan comes with Central Pads."),
        ("What is Central Utility?", "It's the pack for the screens and the desk: 118 backgrounds for the church year, 51 slide themes with matching lower thirds, 14 click sounds, 24 lighting looks, countdowns and stream overlays. It's $50 a year on its own, and it's included in All plans ($270) and in every church bundle."),
        ("What are church bundles?", "Every sound plan plus Central Utility for each person on your team, for less per person. They come in sizes of 4, 8, 12, 16 and 20 people."),
        ("Can I get a refund?", "If something isn't right, tell us within 30 days. The refund policy page has the details."),
        ("How do I cancel?", "Account → Billing opens Stripe's billing page, and you can cancel a plan or subscription there. It keeps working until the end of the time you've paid for."),
        ("What if a plan runs out in the middle of a service?", "Nothing cuts out mid-song. Anything from that plan that's already playing carries on until the song ends. After that it's bypassed and shows which plan it needs. You can't add anything new from that plan until you renew, and when you do, it all comes back on by itself."),
    ]),
    ("Sound and audio", [
        ("The pedal's headphone jack crackles and I can't hear the music.", "Open Settings → Sound → Output device and set Headphone jack buffer to Biggest. The Pi's own jack needs a bigger buffer than a proper sound card. Test sound also turns it up by itself if it hears dropouts."),
        ("Can I use an audio interface?", "Yes, for inputs and outputs. Plug it in before you start and it shows up under Settings → Sound → Output device. Its outputs come after the headphone jack (1 and 2) and the DAC board (3 and 4)."),
        ("There's no sound at all.", "Open Settings → Sound → Test sound on the pedal and press 1. It plays a tone, works out where the sound stops and fixes what it can. If that doesn't do it, the No sound guide in the Help Center goes through the rest."),
    ]),
    ("Lights and video", [
        ("How do I add my real lights?", "In Central Control's Lighting tab, press Find a real light…. You can search 2,272 fixtures by maker and model. If yours isn't there, Make a profile… lets you type in its channels."),
        ("Can the lights follow the songs by themselves?", "Yes. The automatic lights follow each song's sections, and any scenes you've made fire where you put them. You can run a setlist on the 3D stage before Sunday to see how it looks."),
        ("How do I stream?", "Give one computer the Stream mix job on the Devices tab. Its Video tab sends the service to RTMP or SRT destinations, with slides, lyrics and lower thirds on top."),
    ]),
    ("Central Tracks and Make & sell", [
        ("Can I hear a track before I buy it?", "Yes. Every pad, loop, instrument and track has a 30-second preview, here on the website and in the apps."),
        ("How do I publish a track?", "On the home page, go to Central Tracks and press Publish your own track. For sounds, pads, instruments and plugins, use Make & sell. We check every upload before it goes live."),
        ("How do creators get paid?", "For tracks, you get 75% of each sale, plus a share of the subscriber pool when subscribers add your tracks. For Make & sell items, you get a share of each sound plan's money, based on downloads and the stars we give. We pay every month through Stripe."),
    ]),
    ("Planning Center and CCLI", [
        ("How do I connect Planning Center?", "A main admin opens Account → Planning Center & CCLI (or Settings in Central Control), presses Connect Planning Center, signs in and allows it. Until then, you can import a plan from a file."),
        ("Does it report to CCLI for us?", "It counts each time a song's words go up on a screen and fills in the report for you. Download the report from your Account page, in the layout CCLI asks for, and enter it on CCLI's site."),
    ]),
    ("Shorts and social media", [
        ("How are shorts made?", "Once a service recording is 10 minutes or longer, the built-in AI picks the strongest moments from the sermon and the worship and makes vertical clips with captions. You see every one before it's posted."),
        ("Where can shorts be posted?", "YouTube, Facebook, Instagram and TikTok, once you've connected each one in Central Control → Shorts → Settings. You can always download a clip and post it yourself."),
    ]),
    ("Troubleshooting", [
        ("An update failed.", "Open Settings → Software updates and press Try again, or download the newest version from Downloads. On Linux, an update waits for the computer's own updates to finish first, and it tells you why if it still can't install."),
        ("It says it can't reach the website.", "Check the device is online, then look at the status page to see whether sign-in or downloads are down. The apps keep working without the internet."),
        ("The pedal shows as offline.", "Make sure it's on and on the same Wi-Fi. Some networks keep devices apart, so ask for that to be allowed, plug in a cable, or type the pedal's address into Connect."),
    ]),
]

# the best of each plan, each with its 30-second preview (matched by kind and name in the libraries index; the page
# finds the preview's address at /v1/libraries): (kind, name, preset-or-None, what it is)
PICKS = {
    "keys": [
        ("preset", "Sunday Grand", None, "The Steinway B, warm and even. The piano for most of a worship set."),
        ("preset", "Intimate Grand", None, "A softer grand for quiet verses, communion and prayer."),
        ("preset", "Felt Upright Ambient", None, "An upright with felt on the hammers, for close, ambient keys."),
        ("preset", "Sanctuary Organ", None, "Pipe organ for hymns, processions and big last choruses."),
        ("preset", "Quiet Prayer Organ", None, "A gentle organ that sits under someone praying."),
        ("preset", "Sunday Keys Pad", None, "The warm worship pad, to hold under your right hand."),
        ("preset", "Selah Strings", None, "Strings made from real recordings, for swells into the bridge."),
        ("preset", "Super Saw Anthem", None, "A wide synth for big choruses and modern worship."),
        ("preset", "Christmas Bells", None, "Bells for Advent, Christmas Eve and carols."),
        ("preset", "Electric Bells", None, "FM bells for a little sparkle on top of the band."),
    ],
    "instrument": [
        ("preset", "Upright Jazz Bass", None, "A plucked upright bass, round and woody."),
        ("preset", "Clean Hollowbody", None, "A clean hollowbody electric for gentle rhythm parts."),
        ("preset", "Worship Kit (brushes)", None, "A drum kit played with brushes, for quiet songs."),
        ("preset", "Studio Kit", None, "A tight studio drum kit for full-band songs."),
        ("preset", "Worship Harp", None, "A concert harp for intros, prayer and reflection."),
        ("preset", "Alto Sax Ballad", None, "Alto sax for gospel ballads and Christmas."),
        ("loop", "Worship Eighths", None, "A steady eighth-note groove that sits under most worship songs."),
        ("loop", "Gospel Shuffle", None, "A shuffle with swing for gospel and old hymns."),
        ("loop", "6/8 Celtic Toms", None, "Rolling toms in 6/8 for Celtic hymns."),
        ("preset", "Bowed Psaltery Air", None, "A bowed psaltery, airy and unusual, for meditative moments."),
    ],
    "pads": [
        ("pad", "Warm", None, "The everyday worship pad: soft, wide and warm."),
        ("pad", "Sunday Keys", None, "Airy keys that fill the room without getting in the way."),
        ("pad", "Selah", None, "Strings and choir for a pause in the song."),
        ("pad", "Shimmer", None, "A bright shimmer an octave up, for builds."),
        ("pad", "Choir Aah", None, "Voices singing \"aah\", for hymns and communion."),
        ("pad", "Frozen Piano", None, "A piano chord held forever, for prayer times."),
        ("pad", "Harp Wash", None, "Harp runs that blur into a pad."),
        ("pad", "Cathedral Organ", None, "A soft pipe organ chord, for liturgy and hymns."),
        ("loop", "Felt Piano", None, "A felt-piano ambient loop in every key, for between songs."),
        ("loop", "Cello Drone", None, "A low cello drone in every key."),
        ("sound", "Central Pads Swells", "Riser to Key 8s", "A riser into the next song's key, eight seconds long."),
    ],
    "plugins": [
        ("sound", "Central Plugins Textures", "Ambient Drone", "An ambient drone, made with the Central Plugins effects."),
        ("preset", "Plugins: Transitions (risers and swells)", None, "Risers, swells, a downlifter, reverse cymbals and an impact for transitions."),
        ("preset", "Plugins: Ambient Drone Bed", None, "A drone bed to play under the whole song."),
    ],
    "pedals": [
        ("ir", "Central 2x12 Worship Smooth", None, "A smooth 2x12 cabinet: the worship guitar sound."),
        ("ir", "Central 1x12 Open Back", None, "An open-back 1x12 combo, airy and clear."),
        ("ir", "Central 4x12 Vintage", None, "A vintage 4x12 for bigger, crunchier parts."),
        ("ir", "Central 2x10 Tweed", None, "A tweed 2x10, warm and a little bright."),
        ("ir", "Central 4x12 Modern Tight", None, "A tight modern 4x12 for drive and rock."),
        ("ir", "Central Bass 4x10", None, "A 4x10 bass cabinet with punch."),
        ("ir", "Central Acoustic Dreadnought Body", None, "Makes a pickup sound like a dreadnought acoustic."),
        ("ir", "Central Acoustic Nylon Body", None, "A nylon-string body for classical and Spanish guitar."),
    ],
}

# what's free in every app, with no plan (the badge says "Free")
FREE = {
    "keys": ["A grand piano, an electric piano and an organ", "Starter pads and synths", "136 built-in instrument sounds in Central Usage"],
    "instrument": ["Starter bass, guitar and drum kit", "The click and count-in", "136 built-in instrument sounds in Central Usage"],
    "pads": ["A starter pad in every key on the pedal", "Swell and fade on the expression pedal"],
    "plugins": ["A basic EQ, compressor, reverb and delay on every stem, pad and bus", "Plugins you make yourself in Central Production"],
    "pedals": ["A starter drive, delay and reverb", "Your own VST3, AU, CLAP and LV2 plugins on a computer"],
    "utility": ["Plain and gradient backgrounds", "The default click", "Lyrics and slides with the built-in themes"],
}

# Central Utility's parts, in a line each
UTILITY_PARTS = [
    ("118 backgrounds", "Moving and still backgrounds for every season of the church year, for every Sunday, and for youth and kids."),
    ("51 slide themes and lower thirds", "Themes (title, verse and reference) that match the backgrounds, and a lower third for the stream."),
    ("14 click sounds", "Wood block, rim, hi-hat, cowbell, clave, shaker, side stick, triangle, tick, beeps and more, each with its own accent."),
    ("24 lighting looks", "Ready-made looks for Central Control's lights: Sunrise, Ocean, Ember and more."),
    ("Countdowns and stream overlays", "A countdown before service and overlays for the stream."),
    ("\"This Sunday\"", "Central Control suggests the background and theme for this Sunday from the church year."),
]
