# The words on the website's product pages: the apps, their features, the sound plans and the FAQs.
# tools/make-site.py builds the pages from this. Write it the way docs/VOICE.md says: Sam's voice, plain and human.
# Keep every price, plan name, app name and menu path exact.

SUPPORT_EMAIL = "support@motionaudio.org"   # (the server's SUPPORT_EMAIL default; the Help page shows it)

PLATFORMS = {
    "pedal": "Built in to the Central Pedal",
    "mac": "Mac", "win": "Windows", "linux": "Linux", "ios": "iPhone and iPad", "android": "Android", "web": "Web browser",
}

APPS = [
    {
        "slug": "pedal", "name": "Central Pedal", "icon": "central-pedal", "manual": "/apps/central-pedal.html",
        "tag": "The pedal at the worship leader's feet",
        "lede": "A floor unit that plays your pads and multitracks, shows the chart and lyrics, and runs a looper and a guitar or keys rig. It has 12 footswitches, knobs, a touch screen and two HDMI ports. We build and test each one, and it arrives ready to play.",
        "who": ["Worship leader", "Keys player"], "platforms": ["pedal"],
        "buy": {"add": "pedal", "label": "Add the pedal to cart", "note": "You pay once. The software is already on it, it keeps itself up to date, and it doesn't need a key."},
        "shot": "pedal-live", "shots": ["pedal-live", "pedal-pads"],
        "groups": [
            ("On stage", [
                ("The song you're on", "The key, the tempo, how long is left and what's coming next, in type big enough to read from where you stand."),
                ("Jump to any section", "Tap a section on the screen or step through them with a footswitch. Vamp keeps repeating the section you're in, and Safe stop fades out at the end of the bar."),
                ("Songs flow into each other", "When you move to the next song, the pad slides into its key and tempo. There's no gap."),
                ("Lock it for the service", "One button locks the settings so nobody changes something by accident mid-song."),
            ]),
            ("Tracks", [
                ("Multitracks with a click and cues", "Your stems play with a click and spoken cues like \"Verse\" and \"Build\". You can mute or turn down any stem while the song plays."),
                ("Your own songs", "Bring MP3s or WAVs on a USB stick, send them from Central Pedal Control, or add them from Central Tracks."),
                ("Any key, any tempo", "Play a song in a different key or at a different speed. The chart changes with it."),
                ("Tracks and pads are separate", "You can run tracks with no pad, or a pad with no tracks."),
            ]),
            ("Pads and effects", [
                ("Pads in all 12 keys", "With Central Pads and Central Pads Extra you get 82 of them. Some are warm, some airy, some are choir or strings, and six of them move in time with the song."),
                ("Morph, freeze and swell", "Use the expression pedal to blend from one pad to another. You can also freeze the sound where it is, or swell up into the next section."),
                ("Effects on the stems and pads", "A basic EQ, compressor, reverb and delay come free. The plans add better ones, and plugins you build yourself work here too."),
                ("A level for each pad", "Every pad has its own slider. Bus levels and mutes can go on the footswitches."),
            ]),
            ("Looper and instrument", [
                ("A looper with three loops", "Record, overdub and stop up to three loops from the 3.5\" screen, the HDMI screen or Central Pedal Control."),
                ("Plug in a guitar or keyboard", "Play a guitar through pedal boards, or a USB keyboard through the keys sounds."),
                ("Set the controls your way", "The 12 buttons, 6 knobs and 2 sliders can do whatever you want. Change tabs, move around the screen, set bus levels or fire any action."),
            ]),
            ("Screens and sound", [
                ("A touch screen at your feet", "The 3.5\" screen has the pads, tracks, effects, setlist, scenes and looper. If someone uses a mouse on the HDMI screen, you see it here too."),
                ("Two HDMI ports", "Each one can show something different. Put the full app on one and the lyrics for the room on the other, or show the chart."),
                ("Send the sound where you want", "The headphone jack is outputs 1 and 2, a DAC board adds 3 and 4, and a USB audio interface adds more after that. Route each bus wherever you need it."),
                ("It updates itself", "Every few hours it checks for an update and installs it during a quiet minute. It never updates while something is playing. You can also update it from a USB stick."),
            ]),
        ],
    },
    {
        "slug": "pedal-control", "name": "Central Pedal Control", "icon": "central-pedal-control", "manual": "/apps/central-pedal-control.html",
        "tag": "Get the pedal ready from home",
        "lede": "This is where the week's prep happens. Build the setlist, add songs and tracks, set up the pads and the instrument, and decide what each button on the pedal does. When you're done, press Upload and it all goes to the pedal.",
        "who": ["Worship leader", "Whoever gets the songs ready"], "platforms": ["mac", "win", "linux", "ios", "android"],
        "buy": {"add": "pedal-control", "label": "Add a Central Pedal Control key", "note": "Yours for good, on two devices, with all future updates. There's one in every church pack."},
        "shot": "pc-tracks", "shots": ["pc-live", "pc-tracks", "pc-pads", "pc-configure", "pc-io"],
        "groups": [
            ("Songs and setlists", [
                ("+ Add songs", "Add your own MP3s or WAVs, a multitrack, a Prime track, or anything from Central Tracks."),
                ("Sections and cues", "Mark where the verses and choruses are, then set the click, the count-in and the spoken cues."),
                ("Split a song into stems", "Got a stereo recording? The stem splitter pulls out drums, bass, keys and vocals so you can use them as stems."),
                ("Setlists", "Put the songs in order and set the key and tempo for each one. You can open plans from Planning Center too."),
            ]),
            ("Sound", [
                ("Pads and effects", "Choose each pad's sound, key and fade time. Add effects to any stem, pad or bus."),
                ("The instrument", "Set up the sound the pedal makes when you plug in a USB keyboard or a guitar."),
                ("Outputs", "Decide where the pedal's sound goes, whether that's the desk, the in-ears or both."),
            ]),
            ("Controls", [
                ("Configure and Learn", "Pick what each button, knob and pedal does, with a different job for a press and a hold. If you've wired your own controls, press Learn and then touch the control."),
                ("See LIVE before Sunday", "The LIVE tab shows exactly what the pedal's buttons will do during the service."),
                ("Saved setups", "Save the whole setup of the pedal and bring it back later with one tap."),
            ]),
            ("Upload and Download", [
                ("Upload", "Sends everything to the pedal over the church Wi-Fi."),
                ("Download", "Pulls the pedal's setup back to your computer, so you can edit it or keep a copy."),
                ("Runs on what you've got", "Mac, Windows, Linux, iPhone, iPad and Android."),
            ]),
        ],
    },
    {
        "slug": "control", "name": "Central Control", "icon": "central-control", "manual": "/apps/central-control.html",
        "tag": "The desk runs the whole service",
        "lede": "Central Control runs the room from the desk: lights, lyrics, slides, cameras, the stream, in-ears and the run sheet. If you have more than one computer back there, give each one its own jobs and they work together.",
        "who": ["Main admin", "Admin", "Production volunteer"], "platforms": ["mac", "win", "linux"],
        "buy": {"add": "admin", "label": "Add a Central Control key", "note": "One computer per key, with ten releases of updates. Every church pack comes with several."},
        "shot": "cc-lights", "shots": ["cc-service", "cc-lights", "cc-slides", "cc-lyrics", "cc-mix", "cc-inears", "cc-video", "cc-devices"],
        "groups": [
            ("Running the service", [
                ("Run sheets", "Answer a few questions and it puts together a timed run sheet. Press Next and the song, lyrics, lights, slides, camera and stream all move on together."),
                ("Pre-service check", "Half an hour before service it checks the pedals, computers, keys, outputs, mics, lights, cameras, screens and the stream. Anything that isn't right shows amber or red, with what to do about it."),
                ("Give each computer its jobs", "When you set up a computer, pick what it handles. That might be lyrics, lights, cameras, in-ears, tracks, the stream mix or slides."),
                ("Talk", "Hold Talk to speak into everyone's in-ears. Tap it quickly to leave it on."),
                ("Find anything", "Press Ctrl+K (⌘K on a Mac) and type. It finds songs, setlists, settings, presets, slide decks and actions like \"Start stream\"."),
            ]),
            ("Lights", [
                ("Your stage in 3D", "See each light where it hangs and where it's pointing, with haze and trusses. Screens and projectors show whatever the real screens are showing."),
                ("Your actual fixtures", "There are 2,272 real lights to choose from, by maker and model. If yours isn't there, you can make a profile for it."),
                ("Program each light", "Colour, brightness, position, zoom, gobo, strobe and effects, changed live."),
                ("Lights that follow the song", "Auto lights change with the song's sections on their own. If you'd rather describe a look, type it and the AI helper builds it."),
                ("Build my stage", "Answer a few questions and it builds the stage, the room and the seating. You can also trace over a floor plan or a photo."),
                ("Your room and seats", "Draw the auditorium and see how the light falls across the congregation."),
                ("Quick slots and simulate", "There are 10 quick slots and the worship leader's setlist. Simulate plays the whole set on screen without touching the real lights."),
            ]),
            ("Lyrics, slides and video", [
                ("Lyrics that follow the track", "The words move with the song. There are 61 backgrounds built in, moving and still, and you can pick one per song or per section. Central Utility brings that to 118."),
                ("A screen for the band", "The confidence monitor shows the current lines in yellow and the next ones in white, with chords, a clock and messages from the booth."),
                ("Design your own slides", "Use themes, templates, transitions and lower thirds. You can bring in pictures, PDFs and PowerPoint files."),
                ("Scripture in seconds", "Type \"John 3:16\" and you get the slides and a caption for the stream. Four Bible translations are built in."),
                ("Cameras and the stream", "Switch cameras for the room and the stream, with slides and lyrics laid over the top. It streams over RTMP, SRT and NDI."),
            ]),
            ("Sound and in-ears", [
                ("The mix", "The pedal's tracks come in as channels with meters and faders. One button records the whole service."),
                ("Up to 64 in-ear mixes", "Each musician picks a mix and then sets their own levels."),
                ("I/O", "One page shows what comes in, what this computer does with it and what goes out."),
            ]),
            ("After the service", [
                ("Automatic shorts", "The built-in AI finds strong moments in the sermon and high points in the worship, and cuts them into vertical clips with captions. Nothing goes out until you've looked at it and approved it."),
                ("Planning Center and CCLI", "Plans come in as setlists. The copyright line goes on screen by itself, and the CCLI report fills itself in."),
            ]),
        ],
    },
    {
        "slug": "usage", "name": "Central Usage", "icon": "central-usage", "manual": "/apps/central-usage.html",
        "tag": "Each musician's chart, sound and mix",
        "lede": "Central Usage is the app for the people on stage. Each musician and singer gets their own chord chart, the lyrics, their instrument sound and their own in-ear mix. It works at church and at home.",
        "who": ["Musician", "Singer"], "platforms": ["mac", "win", "linux", "ios", "android"],
        "buy": {"add": "user", "label": "Add a Central Usage key", "note": "Each key works on two devices, so a player can have one at church and one at home."},
        "shot": "cu-chart", "shots": ["cu-chart", "cu-lyrics", "cu-inears", "cu-instrument"],
        "groups": [
            ("Charts and lyrics", [
                ("A chart that keeps up", "It highlights where the band is in the song. It's in your key and your clef, and it shows your instrument's part."),
                ("The chart you read best", "Chords over the words, Nashville numbers, a lead sheet or notation."),
                ("Lyrics for the singers", "The words move along with the song and the next lines come up before you need them."),
            ]),
            ("Your sound", [
                ("Your own in-ear mix", "Turn the tracks and the band up or down from your own phone or tablet."),
                ("Play an instrument", "Plug in a keyboard or a guitar. There are 136 sounds built in, and the plans add more."),
                ("Plugins you already own", "On a computer you can use your own VST3, Audio Units, CLAP and LV2 plugins."),
            ]),
            ("Studio and controls", [
                ("Studio", "Record ideas and loops. It runs on the same engine as Central Production, and Open in Central Production takes your work straight there."),
                ("Learn any control", "MIDI pedals, footswitches, keyboards and Stream Deck all work. Press Learn and move the control."),
                ("Two people, one device", "User 1 and User 2 can share a computer, each with their own part and mix."),
                ("Change the colours", "You can change any colour in the app."),
            ]),
        ],
    },
    {
        "slug": "services", "name": "Central Services", "icon": "central-services", "manual": "/apps/central-services.html",
        "tag": "Who's serving, sorted",
        "lede": "Central Services is the church's schedule. It shows the services, who's been asked, who said yes, who's away and what's being played, and everyone has it on their phone.",
        "who": ["Everyone in the church", "Schedulers"], "platforms": ["web", "mac", "win", "linux", "ios", "android"],
        "buy": {"add": "services-slot", "label": "Add a Central Services slot", "note": "One slot per person on your teams, paid once. Every church pack comes with some."},
        "shot": "cs-schedule", "shots": ["cs-schedule", "cs-request", "cs-teams"],
        "groups": [
            ("Scheduling", [
                ("Services and requests", "Schedulers set up a service and ask people from the worship and production teams. Each person gets an email and taps yes or no."),
                ("My requests", "Everyone sees what they've been asked to do, and can leave a note if they can't make it."),
                ("Away", "People mark the dates they'll be away, and the schedulers can see them."),
            ]),
            ("Teams and setlists", [
                ("Teams", "See who serves where, and how many of your church's slots you've used."),
                ("Setlists", "Setlists you make in the apps show up here with their keys and tracks."),
                ("Slots, not keys", "Take someone off a team and their slot opens up for the next person."),
            ]),
        ],
    },
    {
        "slug": "production", "name": "Central Production", "icon": "central-production", "manual": None,
        "tag": "Make tracks, pads, sounds and plugins",
        "lede": "Central Production is a free studio for making your own sounds. Record a song, build a pad or an instrument from a few samples, or put together your own reverb. Then use it in your apps, or sell it on Make & sell.",
        "who": ["Anyone making sounds", "Worship leaders", "Creators"], "platforms": ["mac", "win", "linux", "web"],
        "buy": {"free": True, "label": "Open in your browser", "href": "/production/", "note": "It's free. If you have a sound plan, the better sounds show up inside it."},
        "shot": "production", "shots": ["production"],
        "groups": [
            ("Recording and editing", [
                ("Start from what you're making", "File → New project asks what you're making: a track, a loop, a sample, a pad, an instrument, a plugin or a pedal board."),
                ("Multitrack recording", "Count-in, punch in and out, and loop takes. Each track can use its own input on your audio interface, and it measures the latency for you."),
                ("Tempo and time signature", "Change them anywhere in the song. Loops follow your song's tempo and key."),
                ("Mixing and editing", "Sends, buses and automation, a piano roll, and a drum grid with quantize and humanize."),
            ]),
            ("Plugins", [
                ("Your VST3 and CLAP plugins, live", "They play on every track while the song plays. Turn a knob and you hear it about a fifth of a second later. You only need to freeze a track if your computer is working hard."),
                ("Play a keyboard through them", "Notes from a MIDI keyboard go through the track's plugins, with only a few milliseconds of delay."),
                ("Delays that stay in time", "Any delay can follow the song's tempo, even when the tempo changes. Pick the note you want, from a whole note down to a 1/32, dotted or triplet."),
                ("Build your own plugins", "Drag in blocks like a filter, delay, reverb or drive, add knobs and wire them up. If you'd rather write code, you can."),
                ("They work in the other apps", "A plugin you make plays on the pedal, in Central Control and Central Usage, on the website and in Production."),
            ]),
            ("Getting your work out", [
                ("Export", "Save as WAV or MP3, as stems, or as an SF2 or SFZ instrument. Plugin automation is included in what you export."),
                ("Install into my apps", "Puts what you made straight into Central Control and Central Usage on this computer."),
                ("Publish", "Send it to Make & sell or Central Tracks, and get paid when people use it."),
                ("Saved to your account", "The desktop app and the website open the same projects."),
            ]),
        ],
    },
]

# who needs which app: (row label, then a mark for each app in APPS order). "yes" / "some" / "".
COMPARE = [
    ("Who uses it", ["Worship leader or keys", "Whoever gets the songs ready", "Main admin and admins", "Musicians and singers", "Everyone", "Anyone making sounds"]),
    ("Plays pads and tracks live", ["yes", "", "yes", "", "", ""]),
    ("Builds setlists and songs", ["yes", "yes", "yes", "", "some", "yes"]),
    ("Chord charts and lyrics", ["yes", "", "yes", "yes", "", ""]),
    ("Lights, slides, cameras and stream", ["", "", "yes", "", "", ""]),
    ("In-ear mixes", ["some", "", "yes", "yes", "", ""]),
    ("An instrument sound", ["yes", "yes", "yes", "yes", "", "yes"]),
    ("Scheduling the team", ["", "", "some", "", "yes", ""]),
    ("Makes tracks, pads and plugins", ["", "", "", "some", "", "yes"]),
    ("How you get it", ["Buy the pedal", "P key (in every pack)", "A key (in every pack)", "U key (in every pack)", "Slots (in every pack)", "Free"]),
]

# the sound plans (prices come from the server's /config; these are the words)
PLANS = [
    {"id": "keys", "name": "Central Keys", "tag": "Pianos, organs, mallets, pads and synths",
     "lede": "Two grand pianos, an upright and some FM pianos. Pipe organs and quieter organs. Vibraphone, marimba and bells. Fifteen stereo pads that each have their own sound, and ten synths we made ourselves. Central Pads comes with it.",
     "highlights": ["Steinway B and Kawai grands, and soft versions that really are soft", "Sunday Pad, Ember Pad and Selah Strings, worship pads made from real recordings", "Ten very different synths, from leads and brass to a string machine and FM bells", "Presets set up for worship on every sound"],
     "kinds": ["preset", "sound"]},
    {"id": "instrument", "name": "Central Instrument", "tag": "Bass, guitar, strings, brass, drums and loops",
     "lede": "For the musicians who don't play keys. Basses, guitars, strings, brass, woodwinds and drum kits, plus 20 drum grooves and 8 ambient loops in every key. Central Pads comes with it.",
     "highlights": ["Real basses and guitars", "Orchestral strings and brass", "20 drum grooves, from a gospel shuffle to 6/8 Celtic toms", "Ambient loops in all 12 keys, like felt piano, guitar swells, a cello drone and harp"],
     "kinds": ["preset", "sound", "loops", "loop"]},
    {"id": "pads", "name": "Central Pads", "tag": "Pads in every key for the pad pedal",
     "lede": "82 pads in all 12 keys. There are 41 in Central Pads, and Central Pads Extra adds 35 more plus six that move in time with the song. They're all true stereo and loop without a seam, and there are swells, risers and transitions to go with them. Every other plan includes it.",
     "highlights": ["Sunday Keys, the warm, airy pad most people start with", "Pads made from real piano, strings, harp and organ recordings", "Six moving pads that pulse with the song", "Swells, risers, downlifters and an arrival hit in every key", "Ambient loops and a room bed for the gaps between songs"],
     "kinds": ["pad", "loop", "loops", "sound"]},
    {"id": "plugins", "name": "Central Plugins", "tag": "Better effects on every track, pad and bus",
     "lede": "32 plugins, including EQs, compressors, reverbs and delays, for the stems, the pads, both buses and the mixer's channels. They work in all the apps. You get a basic version of each kind for free, and the plan gets you the good ones. Central Pads comes with it.",
     "highlights": ["Studio EQ, compressor, limiter and de-esser", "Halls, plates and shimmer reverbs", "Delays that follow the song's tempo", "Works in Central Control, Central Usage and on the pedal"],
     "kinds": ["preset", "sound"]},
    {"id": "pedals", "name": "Central Pedals", "tag": "Guitar pedals and amp cabinets",
     "lede": "Guitar pedals for anything you can plug in with a 1/4\" or 1/8\" cable. You get 55 pedals of our own and 68 ready-made boards, with real cabinet impulse responses for the amp sound. Central Pads comes with it.",
     "highlights": ["Drives, fuzzes, modulation and ambient pedals", "28 cabinet and room impulse responses", "68 ready-made boards, five of them amps with cabinets", "Play through it on the pedal or in Central Usage"],
     "kinds": ["ir"]},
    {"id": "utility", "name": "Central Utility", "tag": "Backgrounds, slide themes, clicks and looks",
     "lede": "118 backgrounds for the church year, with 51 slide themes and lower thirds to match. It also has 14 click sounds, 24 lighting looks, countdowns and stream overlays. It's included in All plans and in every church bundle.",
     "highlights": ["Backgrounds for Advent, Christmas, Easter, Pentecost and ordinary Sundays", "A \"This Sunday\" suggestion that follows the church year", "14 click sounds, each with its own accent", "24 lighting looks, countdowns and stream overlays"],
     "kinds": []},
]

TRACKS = {"id": "tracks", "name": "Central Tracks Unlimited", "tag": "Every track in the library, every month",
          "lede": "The whole library: pads, multitracks and Prime tracks, the 20 hymns we've arranged, and the sounds, pedal boards and clicks other teams have shared. Whatever you add goes into your setlist with its chart and lyrics."}

# the FAQ on the Pricing page
PRICING_FAQ = [
    ("Do I pay once or every year?", "Church packs, the pedal and the app keys are a one-time payment. Sound plans and Central Utility renew each year, and Central Tracks Unlimited is monthly. Tax is included in every price."),
    ("What's in a church pack?", "Central Control keys for your main admin and admins, Central Usage keys for your musicians, a Central Pedal Control key and Central Services slots for your team. The pedal isn't included, so you can start with the gear you already have."),
    ("Which sound plan do I need?", "It depends who's playing. Keys players want Central Keys, and the rest of the band wants Central Instrument. If you run the pad pedal, Central Pads covers it, and it comes with every other plan anyway. Central Plugins is for better effects, Central Pedals is for guitarists, and Central Utility is for lyric backgrounds and slide themes. If you're not sure, the helper above will pick for you."),
    ("How many devices does a sound plan work on?", "One package key works on three of your devices at the same time, as long as each one is a different app. For example, Central Usage, Central Control and your pedal."),
    ("What does a church bundle give us?", "A package key for each person on your team, with every sound plan, Central Pads and Central Utility, for a year. You hand the keys out on the Teams page and you can move one to someone else whenever you need to."),
    ("Do the apps stop working if we don't renew?", "No. Keys you've bought keep working. Central Control keys come with ten releases of updates, and you can renew for $20 whenever you like. Sound plans work for as long as the plan is active. If a plan runs out during a service, whatever is playing finishes the song first."),
    ("Can we try it first?", "Yes. Put a trial code in the cart, or use the demo church's keys from the Help Center to try all the apps."),
    ("What about refunds?", "If something isn't right, tell us within 30 days and we'll sort it out. The refund policy has the details."),
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
        ("preset", "Plugins: Transitions (risers and swells)", None, "Risers, swells, reverse cymbals and an impact for getting from one song to the next."),
        ("preset", "Plugins: Ambient Drone Bed", None, "A drone bed to play under the whole song."),
    ],
    "pedals": [
        ("ir", "Central 2x12 Worship Smooth", None, "A smooth 2x12 cabinet. This is the classic worship guitar sound."),
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
    ("118 backgrounds", "Moving and still backgrounds for the seasons of the church year and for ordinary Sundays. There are some for youth and kids too."),
    ("51 slide themes and lower thirds", "Each theme matches a background and lays out a title, a verse and its reference. There's a lower third for the stream as well."),
    ("14 click sounds", "Wood block, rim, hi-hat, cowbell, clave, shaker, side stick, triangle, a plain tick and a few beeps. Each one has its own accent for the first beat."),
    ("24 lighting looks", "Ready-made looks for Central Control's lights, with names like Sunrise, Ocean and Ember."),
    ("Countdowns and stream overlays", "A countdown to put up before the service starts, and overlays for the stream."),
    ("\"This Sunday\"", "Central Control knows where we are in the church year and suggests a background and theme for this Sunday."),
]
