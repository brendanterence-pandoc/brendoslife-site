// Starter data for Home Projects. Written once, the first time the store is
// opened (see HomeProjectsDO.seedOnce). Every figure here comes from Brendan's
// own documents as of mid-November 2026:
//   - Front Office Install Plan, Sheet A-6 (Nov 6, 2026) and the Nov 7 hanging diagram
//   - Picasso Framing Brief (Nov 5, 2026) and the Swann Galleries invoice thread
//   - Blue Door Picture Framing invoice 4924 (Oct 13, 2026)
//   - Framing Specification: Waters Edge (Oct 24, 2026)
//   - Sofa Console Fabrication Spec, Revision 2 (Oct 11, 2026) and the quote emails
//   - Jessica Bush's furniture purchase sheet (Oct 21, 2026)
// Where no record exists (gallery wall, lanai speakers) the project starts empty.

type Row = Record<string, unknown>;

const photo = (id: string, roomId: string, kind: string, file: string, w: number, h: number, caption: string, itemId = ""): Row => ({
    id, roomId, kind, src: `seed/${file}.jpg`, w, h, caption, itemId, projectId: "",
});

export const HOME_SEED: Record<string, Row[]> = {
    room: [
        { id: "front-office", name: "Front Office", note: "Set up as a video-call set: Warhol, you, then the dressed shelf.", coverPhotoId: "ph-office-elevation" },
        { id: "living-room", name: "Living Room", note: "", coverPhotoId: "" },
        { id: "primary-bedroom", name: "Primary Bedroom", note: "", coverPhotoId: "" },
        { id: "lanai", name: "Lanai", note: "", coverPhotoId: "" },
    ],

    measurement: [
        // Front office (Install Plan, Sheet A-6)
        { id: "m-office-art-wall", roomId: "front-office", kind: "wall", label: "Art wall, kitchen pier to window-wall corner", w: 160, h: null, d: null, note: "13 ft 4 in. Bosch laser. All horizontal positions are measured from the kitchen pier." },
        { id: "m-office-width", roomId: "front-office", kind: "wall", label: "Room width along the window wall", w: 134.5, h: null, d: null, note: "11 ft 2.5 in. Tape." },
        { id: "m-office-warhol", roomId: "front-office", kind: "furniture", label: "Warhol Pink Cow, outside of frame", w: 38, h: 56, d: null, note: "Sits 61 to 99 in from the pier, 30 to 86 in off the floor. Center at 58 in." },
        { id: "m-office-hooks", roomId: "front-office", kind: "other", label: "Warhol hooks, height off the floor", w: null, h: 76.75, d: null, note: "Two hooks at 78 in and 82 in from the pier. Wire apex is 9.25 in below the frame top. Re-measure the wire once before drilling." },
        { id: "m-office-shelves", roomId: "front-office", kind: "furniture", label: "Bookshelf, each of two", w: 32, h: 72, d: null, note: "Shelf 1 at 17 to 49 in from the pier. Shelf 2 at 111 to 143 in. 12 in gaps, 17 in end margins." },
        { id: "m-office-picasso", roomId: "front-office", kind: "furniture", label: "Picasso, planned outside of frame", w: 19.25, h: 25.75, d: null, note: "Sheet is 18.5 x 12.25 in. Needs about 26 in of clear height on a shelf." },
        { id: "m-office-desk", roomId: "front-office", kind: "furniture", label: "Desk zone", w: 72, h: null, d: 30, note: "Back edge 54 in off the art wall, centered on the 105 in mark. A 72 in desk runs 69 to 141 in from the pier." },
        // Living room (console spec rev 2)
        { id: "m-living-sofa", roomId: "living-room", kind: "furniture", label: "Sofa, nominal overall", w: 84, h: 35, d: 43, note: "From the console spec. Confirm against the delivered sofa." },
        { id: "m-living-console", roomId: "living-room", kind: "furniture", label: "Sofa console, finished envelope", w: 79, h: 30, d: 12.5, note: "Steel frame 78 x 11.5 x 29. Shelf tops at 6 in and 16 in. Height set at 30 in to sit below the sofa back." },
        // Primary bedroom (framing spec)
        { id: "m-bed-bed", roomId: "primary-bedroom", kind: "furniture", label: "King bed, width and headboard height", w: 79, h: 52.25, d: null, note: "" },
        { id: "m-bed-dresser", roomId: "primary-bedroom", kind: "furniture", label: "Low dresser, width", w: 60, h: null, d: null, note: "" },
        { id: "m-bed-rowboat", roomId: "primary-bedroom", kind: "furniture", label: "Rowboat painting, in its frame", w: 43, h: 32, d: null, note: "Hangs with the bottom at 61.25 in, 9 in above the headboard. Top lands near 93 in." },
    ],

    project: [
        {
            id: "p-warhol-picasso", roomId: "front-office", name: "Warhol and Picasso placement", status: "In progress",
            note: "Install order is shelves first, then the Warhol, then desk and camera, then shelf dressing. The Warhol is centered on the 160 in wall between the two shelves. The Picasso goes in the second bay of Shelf 2 (48 to 60 in off the floor) with a lamp on the bay below. Rental: keep a list of hook locations for patching at move-out.",
            steps: [
                { id: "s1", text: "Buy 2 picture hangers (install plan says OOK 50 lb, the Nov 7 diagram says OOK 75 lb safety hangers), 4 felt bumpers, and 2 quarter-inch Snaptoggles in case the shelf brackets miss a stud", done: false },
                { id: "s2", text: "Assemble and anchor both shelves at 17 to 49 in and 111 to 143 in from the pier", done: false },
                { id: "s3", text: "Record the cabinet-top height. If it is above 30 in, raise the hooks by the difference", done: false },
                { id: "s4", text: "Re-measure the Warhol wire pulled taut (9.25 in expected)", done: false },
                { id: "s5", text: "Set two hooks at 76.75 in off the floor, 78 in and 82 in from the pier, and level them to each other", done: false },
                { id: "s6", text: "Hang the Warhol. Target frame top 86 in at both corners. Add bumpers", done: false },
                { id: "s7", text: "Get an itemized framing quote for the Picasso from the brief", done: false },
                { id: "s8", text: "Place the framed Picasso on Shelf 2, second bay, with museum putty at the back corners", done: false },
                { id: "s9", text: "Place desk, chair, and camera, then run the 10 a.m. and 4 p.m. camera checks", done: false },
            ],
        },
        {
            id: "p-gallery-wall", roomId: "living-room", name: "Living room gallery wall", status: "Planning",
            note: "Nothing on file for this wall yet. Start by adding a photo of the wall and its width and height under Measurements. House standard from the framing spec: slim matte black frames for photographs, walnut where a piece needs warmth, centers at 57 to 60 in.",
            steps: [
                { id: "s1", text: "Photograph the wall and record its width and height", done: false },
                { id: "s2", text: "List the pieces and their framed sizes", done: false },
                { id: "s3", text: "Mock up the layout and add it here", done: false },
                { id: "s4", text: "Frame, then hang from the center out", done: false },
            ],
        },
        {
            id: "p-sofa-console", roomId: "living-room", name: "Custom sofa console", status: "In progress",
            note: "Freestanding welded console behind the 84 in sofa. 79 W x 12.5 D x 30 H, 1 x 1 in square tube, two shelves at 6 and 16 in, black low-satin finish, no visible fasteners. Target is about $1,000, not a hard cap. Quotes requested Oct 11 from Metal Creations, Static Fabrication, and Adrenaline Artworks. Follow-ups sent Oct 27. Luke at Adrenaline replied Oct 29 that he would pick it up the following week, and he works mostly in aluminum. Sunset Metal Company was Jessica's referral.",
            steps: [
                { id: "s1", text: "Write fabrication spec, Revision 2", done: true },
                { id: "s2", text: "Request quotes from three local shops", done: true },
                { id: "s3", text: "Receive itemized quotes", done: false },
                { id: "s4", text: "Pick the plan and the fabricator", done: false },
                { id: "s5", text: "Approve shop drawing and black finish sample", done: false },
                { id: "s6", text: "Delivery and placement behind the sofa", done: false },
            ],
        },
        {
            id: "p-bedroom-art", roomId: "primary-bedroom", name: "Art over the bed and dresser", status: "Planning",
            note: "From the Oct 24 framing spec. Rowboat painting goes over the king bed in its existing frame, two D-rings into studs or rated anchors. Eagle at blue hour goes above the 60 in low dresser, centered, bottom 8 to 10 in above the dresser top.",
            steps: [
                { id: "s1", text: "Wait for the bed, then confirm the 52.25 in headboard height", done: false },
                { id: "s2", text: "Hang the rowboat painting with the bottom at 61.25 in", done: false },
                { id: "s3", text: "Approve the eagle print proof, then frame to about 40 x 30 in", done: false },
                { id: "s4", text: "Hang the eagle centered on the dresser", done: false },
            ],
        },
        {
            id: "p-lanai-speakers", roomId: "lanai", name: "Lanai speaker setup", status: "Planning",
            note: "Nothing on file yet. Add photos of the lanai, the mounting spots you have in mind, and the options you are weighing. Rental: prefer small or existing holes.",
            steps: [
                { id: "s1", text: "Photograph the lanai and mark where speakers could go", done: false },
                { id: "s2", text: "Decide on wired or wireless and where power comes from", done: false },
                { id: "s3", text: "Add two or three speaker options and compare", done: false },
                { id: "s4", text: "Order, mount, and test", done: false },
            ],
        },
    ],

    decision: [
        {
            id: "d-console-build", roomId: "living-room", projectId: "p-sofa-console", name: "Sofa console build",
            note: "Same 79 x 12.5 x 30 envelope either way. Fill in each price as quotes arrive.", pickedItemId: "",
        },
    ],

    item: [
        // ---- Front office ----
        {
            id: "i-warhol", roomId: "front-office", projectId: "p-warhol-picasso", decisionId: "", name: "Warhol, Pink Cow", category: "Artwork", status: "Arrived",
            price: null, qty: 1, w: 38, h: 56, d: null, link: "", vendor: "Michael Lisi Contemporary Art (Nancy Rich)",
            note: "Framed with museum glass, about 30 to 40 lb. Measured Nov 6. Ready to hang per the install plan. Purchase price not entered.", photoId: "",
        },
        {
            id: "i-warhol-framing", roomId: "front-office", projectId: "p-warhol-picasso", decisionId: "", name: "Framing, Warhol Cow", category: "Framing", status: "Arrived",
            price: 860.48, qty: 1, w: 38, h: 56, d: null, link: "", vendor: "Blue Door Picture Framing, Sarasota",
            note: "Work order 7881 on invoice 4924, Oct 13. $907.11 less a $46.63 discount, before 7% tax.", photoId: "",
        },
        {
            id: "i-picasso", roomId: "front-office", projectId: "p-warhol-picasso", decisionId: "", name: "Picasso, Shakespeare (1965), 9/150", category: "Artwork", status: "Ordered",
            price: 3059.13, qty: 1, w: 12.25, h: 18.5, d: null, link: "", vendor: "Swann Galleries, Lot 294",
            note: "Lithograph, Bloch 1197 / Mourlot 405, pencil signed. Bought post-sale at $2,200 hammer plus 27% premium. Price shown is the full wire sent Nov 9, with packing, ground shipping, and tax. Dimensions are the sheet.", photoId: "",
        },
        {
            id: "i-picasso-framing", roomId: "front-office", projectId: "p-warhol-picasso", decisionId: "", name: "Framing, Picasso", category: "Framing", status: "Considering",
            price: null, qty: 1, w: 19.25, h: 25.75, d: null, link: "", vendor: "",
            note: "Per the Nov 5 brief: 8-ply warm white rag mat, Japanese tissue hinges, Tru Vue Water White Museum Glass, slim dark walnut frame with a 1.25 in face. Nothing trimmed or taped. Ask for an itemized written quote.", photoId: "",
        },
        {
            id: "i-bookcases", roomId: "front-office", projectId: "p-warhol-picasso", decisionId: "", name: "Nathan James Beacon bookshelves", category: "Furniture", status: "Arrived",
            price: 900, qty: 1, w: 32, h: 72, d: null, link: "", vendor: "Ordered through Jessica Bush",
            note: "Pair, $900 for both, ordered Oct 21. Closed cabinet base, wall-anchored at the top. Install plan measures them 32 x 72 in from the box label. Jessica's sheet lists 36 x 72 in.", photoId: "ph-bookcase",
        },
        {
            id: "i-desk", roomId: "front-office", projectId: "", decisionId: "", name: "Desk, 72 in trestle with walnut top", category: "Furniture", status: "Considering",
            price: null, qty: 1, w: 72, h: null, d: 30, link: "", vendor: "",
            note: "60 to 72 in works, 72 preferred. Also asked the console fabricators about steel legs for an executive wood desk.", photoId: "",
        },
        {
            id: "i-shelf-lamp", roomId: "front-office", projectId: "p-warhol-picasso", decisionId: "", name: "Table lamp for Shelf 2", category: "Lighting", status: "Considering",
            price: null, qty: 1, w: null, h: 20, d: null, link: "", vendor: "",
            note: "About 18 to 22 in tall, warm metal or ceramic base, 2700K bulb. On for every call. House rule on frames is black or stainless, no brass or gold.", photoId: "",
        },
        {
            id: "i-key-light", roomId: "front-office", projectId: "", decisionId: "", name: "Key light", category: "Lighting", status: "Considering",
            price: null, qty: 1, w: null, h: null, d: null, link: "", vendor: "",
            note: "Small soft LED panel with stand, dimmable, 3000K to 4000K. Window side of the desk, aimed at the face from about 45 degrees.", photoId: "",
        },
        {
            id: "i-office-chairs", roomId: "front-office", projectId: "", decisionId: "", name: "Office side chairs", category: "Furniture", status: "Installed",
            price: 720, qty: 2, w: 24, h: null, d: null, link: "", vendor: "Arhaus",
            note: "Mocha and ecru fabric. Angle them in at the desk ends, front legs about 24 in from the desk edge.", photoId: "ph-office-chair",
        },
        // ---- Living room ----
        {
            id: "i-console-a", roomId: "living-room", projectId: "p-sofa-console", decisionId: "d-console-build", name: "Plan A, all steel", category: "Furniture", status: "Considering",
            price: null, qty: 1, w: 79, h: 30, d: 12.5, link: "", vendor: "",
            note: "Formed steel top and two formed steel shelves on the welded black frame.", photoId: "ph-console-a",
        },
        {
            id: "i-console-b", roomId: "living-room", projectId: "p-sofa-console", decisionId: "d-console-build", name: "Plan B, steel with walnut top and shelves", category: "Furniture", status: "Considering",
            price: null, qty: 1, w: 79, h: 30, d: 12.5, link: "", vendor: "",
            note: "Same frame with a solid black walnut top and two walnut shelves, 1 in thick, hardwax oil. Quote two ways: fabricator supplies the wood, or frame only.", photoId: "ph-console-b",
        },
        {
            id: "i-console-c", roomId: "living-room", projectId: "p-sofa-console", decisionId: "d-console-build", name: "Powder-coated aluminum frame", category: "Furniture", status: "Considering",
            price: null, qty: 1, w: 79, h: 30, d: 12.5, link: "", vendor: "Adrenaline Artworks Welding & Fabrication",
            note: "Came up on the Oct 21 call with Luke, who specializes in aluminum. No drawing or quote yet.", photoId: "",
        },
        {
            id: "i-sofa", roomId: "living-room", projectId: "", decisionId: "", name: "Sofa", category: "Furniture", status: "Installed",
            price: 3500, qty: 1, w: 84, h: 35, d: 43, link: "", vendor: "Arhaus",
            note: "Arrived per Jessica's Oct 21 sheet. Dimensions are the nominal figures from the console spec.", photoId: "ph-sofa",
        },
        {
            id: "i-recliner", roomId: "living-room", projectId: "", decisionId: "", name: "Leather recliner", category: "Furniture", status: "Ordered",
            price: 5670, qty: 1, w: 38, h: null, d: null, link: "", vendor: "Arhaus",
            note: "Albee chocolate leather. Ordered Sep 30, expected early December. Photo is not the correct leather.", photoId: "ph-recliner",
        },
        {
            id: "i-swivel", roomId: "living-room", projectId: "", decisionId: "", name: "Rolled-arm swivel chair", category: "Furniture", status: "Ordered",
            price: 2100, qty: 1, w: 32, h: null, d: null, link: "", vendor: "Arhaus",
            note: "Lino chambray. Ordered Sep 30, expected early December. Photo is not the correct fabric.", photoId: "ph-swivel",
        },
        {
            id: "i-coffee-table", roomId: "living-room", projectId: "", decisionId: "", name: "Coffee table", category: "Furniture", status: "Ordered",
            price: 425, qty: 1, w: 44, h: null, d: null, link: "", vendor: "Ordered through Jessica Bush",
            note: "Blonde finish. Ordered Oct 21, was expected early November. Mark it arrived if it is in the house.", photoId: "ph-coffee-table",
        },
        // ---- Primary bedroom ----
        {
            id: "i-bed", roomId: "primary-bedroom", projectId: "", decisionId: "", name: "King bed", category: "Furniture", status: "Ordered",
            price: 2950, qty: 1, w: 79, h: 52.25, d: null, link: "", vendor: "Ordered through Jessica Bush",
            note: "Laine natural fabric. Ordered Sep 30, estimated late November. Shipping was $320.", photoId: "ph-bed",
        },
        {
            id: "i-nightstands", roomId: "primary-bedroom", projectId: "", decisionId: "", name: "Burled walnut bedside tables", category: "Furniture", status: "Ordered",
            price: 600, qty: 2, w: 30, h: null, d: null, link: "", vendor: "Ordered through Jessica Bush",
            note: "Ordered Sep 30, December delivery. White glove shipping was $200.", photoId: "ph-nightstand",
        },
        {
            id: "i-rowboat", roomId: "primary-bedroom", projectId: "p-bedroom-art", decisionId: "", name: "Rowboat painting on wood", category: "Artwork", status: "Arrived",
            price: null, qty: 1, w: 43, h: 32, d: null, link: "", vendor: "",
            note: "Already owned, keep the existing frame. Hangs over the bed once the bed is in. Needs studs or rated anchors, no single nail.", photoId: "",
        },
        {
            id: "i-eagle", roomId: "primary-bedroom", projectId: "p-bedroom-art", decisionId: "", name: "Eagle at blue hour, print and frame", category: "Artwork", status: "Considering",
            price: null, qty: 1, w: 40, h: 30, d: null, link: "", vendor: "",
            note: "30 x 20 in archival matte print, 4 in bright white 8-ply mat, slim matte black frame, museum acrylic. About 40 x 30 in finished. Approve the proof before printing.", photoId: "",
        },
    ],

    photo: [
        photo("ph-office-elevation", "front-office", "mockup", "office-art-wall-elevation", 1600, 907, "Art wall elevation, from the Nov 6 install plan"),
        photo("ph-office-plan", "front-office", "mockup", "office-plan-view", 1600, 1043, "Plan view with the camera cone and desk position"),
        photo("ph-office-hanging", "front-office", "mockup", "office-warhol-hanging", 1600, 1010, "Hanging the Warhol on two hooks, Nov 7 diagram"),
        photo("ph-bookcase", "front-office", "item", "bookcase", 266, 504, "", "i-bookcases"),
        photo("ph-office-chair", "front-office", "item", "office-side-chair", 1108, 1200, "", "i-office-chairs"),
        photo("ph-console-a", "living-room", "item", "console-plan-a", 1552, 653, "Plan A front elevation", "i-console-a"),
        photo("ph-console-b", "living-room", "item", "console-plan-b", 1552, 653, "Plan B front elevation", "i-console-b"),
        photo("ph-sofa", "living-room", "item", "sofa", 1200, 524, "", "i-sofa"),
        photo("ph-recliner", "living-room", "item", "recliner", 1200, 978, "", "i-recliner"),
        photo("ph-swivel", "living-room", "item", "swivel-chair", 1200, 988, "", "i-swivel"),
        photo("ph-coffee-table", "living-room", "item", "coffee-table", 1200, 425, "", "i-coffee-table"),
        photo("ph-bed", "primary-bedroom", "item", "bed", 956, 694, "", "i-bed"),
        photo("ph-nightstand", "primary-bedroom", "item", "nightstand", 348, 326, "", "i-nightstands"),
    ],
};
