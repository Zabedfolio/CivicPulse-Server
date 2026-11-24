/**
 * CivicPulse Production-Fidelity Database Seeder Engine
 * Populates official demo accounts, 5 municipal departments, 20+ field technicians,
 * and 100+ realistic geocoded incidents across Chattogram's 41 wards with full relational history.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Department = require("../models/Department");
const Issue = require("../models/Issue");
const Task = require("../models/Task");
const Feedback = require("../models/Feedback");
const IssueStatusHistory = require("../models/IssueStatusHistory");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");

// Landmarks with authentic Chattogram coordinates [longitude, latitude]
const CHATTOGRAM_HUBS = [
  { name: "Agrabad Commercial Area", ward: "Ward 24", address: "Agrabad C/A, Badamtali Mor, Chattogram", coords: [91.8123, 22.3256] },
  { name: "GEC Circle", ward: "Ward 15", address: "GEC Circle, O.R. Nizam Road, Chattogram", coords: [91.8215, 22.3587] },
  { name: "Nasirabad Industrial Area", ward: "Ward 2", address: "Baizid Bostami Road, Nasirabad, Chattogram", coords: [91.8194, 22.3701] },
  { name: "Chawkbazar Commercial Zone", ward: "Ward 16", address: "College Road, Chawkbazar, Chattogram", coords: [91.8412, 22.3562] },
  { name: "Halishahar Housing Estate", ward: "Ward 26", address: "Block B, Halishahar H/E, Chattogram", coords: [91.7765, 22.3481] },
  { name: "Bahaddarhat Flyover Junction", ward: "Ward 4", address: "Bahaddarhat Bus Terminal Mor, Chattogram", coords: [91.8491, 22.3724] },
  { name: "Port Access Road / Custom House", ward: "Ward 36", address: "Port Access Highway, Bandar, Chattogram", coords: [91.7952, 22.3195] },
  { name: "Muradpur Intersection", ward: "Ward 7", address: "Hathazari Road, Muradpur, Chattogram", coords: [91.8341, 22.3654] },
  { name: "Lalkhan Bazar & Tigerpass", ward: "Ward 14", address: "Tigerpass Crossway, Lalkhan Bazar, Chattogram", coords: [91.8210, 22.3498] },
  { name: "Kotwali & Anderkilla", ward: "Ward 32", address: "Anderkilla Shahi Jame Masjid Road, Chattogram", coords: [91.8385, 22.3375] },
  { name: "Khulshi Residential Area", ward: "Ward 8", address: "Zakir Hossain Road, South Khulshi, Chattogram", coords: [91.8025, 22.3621] },
  { name: "Panchlaish Medical Zone", ward: "Ward 15", address: "Prabartak Circle, Panchlaish, Chattogram", coords: [91.8280, 22.3688] },
  { name: "Sadarghat Karnaphuli Riverbank", ward: "Ward 33", address: "Strand Road, Sadarghat Ferry Ghat, Chattogram", coords: [91.8320, 22.3290] },
  { name: "Firingi Bazar Marine Drive", ward: "Ward 34", address: "Firingi Bazar Bridge Approach, Chattogram", coords: [91.8410, 22.3315] },
  { name: "Sholashahar Junction", ward: "Ward 8", address: "Sholashahar Railway Station Road, Chattogram", coords: [91.8290, 22.3610] },
];

// Curated high-resolution infrastructure evidence photos
const CATEGORY_IMAGES = {
  "Road Damage": [
    "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1578955274801-e28c946c8f32?w=800&auto=format&fit=crop&q=80",
  ],
  Streetlight: [
    "https://images.unsplash.com/photo-1508873696983-2df5293cb32f?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=800&auto=format&fit=crop&q=80",
  ],
  Drainage: [
    "https://images.unsplash.com/photo-1547683905-f686c993aae5?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1584467735871-8e85353a8413?w=800&auto=format&fit=crop&q=80",
  ],
  Footpath: [
    "https://images.unsplash.com/photo-1596701062351-8c2c14d1fdd1?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&auto=format&fit=crop&q=80",
  ],
  "Waste Management": [
    "https://images.unsplash.com/photo-1605600659908-0ef719419d41?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=800&auto=format&fit=crop&q=80",
  ],
  "Public Infrastructure": [
    "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&auto=format&fit=crop&q=80",
  ],
};

const COMPLETION_PROOF_IMAGES = [
  "https://images.unsplash.com/photo-1590496793929-36417d3117de?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1541888946425-d0fbb1861593?w=800&auto=format&fit=crop&q=80",
];

// Issue title templates per category
const ISSUE_TEMPLATES = {
  "Road Damage": [
    "Severe pothole cluster damaging vehicles after heavy downpour",
    "Bitumen wash-off exposing sharp crushed stones on dual carriageway",
    "Asphalt subsidence near drainage culvert causing traffic bottleneck",
    "Deep trench left unpaved after underground utility excavation",
    "Sunken road surface near bus stop creating severe vehicle undercarriage scrape",
  ],
  Streetlight: [
    "High-mast illumination luminaire flickering continuously at night",
    "Complete electrical black-out across five consecutive lamp poles",
    "Damaged underground wiring junction box with exposed active conductors",
    "Overhanging streetlight pole unstable after freight vehicle collision",
    "LED street lamp failed to trigger during evening hours",
  ],
  Drainage: [
    "Stormwater culvert clogged with silt and polythene causing knee-deep waterlogging",
    "Fractured RCC drain cover creating hazardous trap for pedestrians",
    "Overflowing sewage canal flooding adjacent commercial storefronts",
    "Drainage sluice gate silted up preventing monsoon storm runoff",
    "Severe stormwater backflow into residential alleyway",
  ],
  Footpath: [
    "Missing tactile paving slabs creating hazard for visually impaired citizens",
    "Broken concrete walkway blocks causing severe pedestrian trip risks",
    "Damaged stainless steel pedestrian safety guardrail near school zone",
    "Sunken footpath pavement adjacent to primary road divider",
    "Footpath curb cracked and partially collapsed onto carriageway",
  ],
  "Waste Management": [
    "Secondary transfer station dumpster overflowing onto main walkway",
    "Illegal construction debris dumped along roadside obstructing pedestrians",
    "Uncollected municipal organic refuse creating foul odor and pest hazard",
    "Compactor bin damaged and spilling contents onto thoroughfare",
    "Litter accumulation blocking street stormwater grating",
  ],
  "Public Infrastructure": [
    "Pedestrian footbridge steel staircase rusted with missing tread step",
    "Public overpass expansion joint rubber damaged creating safety hazard",
    "Damaged municipal traffic signpost leaning dangerously over sidewalk",
    "Cracked concrete support pillar on pedestrian walkway bridge",
    "Defaced civic signage board obstructing intersection visibility",
  ],
};

async function seed() {
  console.log("🌱 Starting CivicPulse Database Seeder...");

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("❌ Error: MONGO_URI is missing in environment variables!");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("✅ Connected to MongoDB Atlas");

  const db = mongoose.connection.db;

  // 1. Clean existing data
  console.log("🧹 Purging old collections...");
  await Promise.all([
    User.deleteMany({}),
    db.collection("account").deleteMany({}),
    Department.deleteMany({}),
    Issue.deleteMany({}),
    Task.deleteMany({}),
    Feedback.deleteMany({}),
    IssueStatusHistory.deleteMany({}),
    Notification.deleteMany({}),
    ActivityLog.deleteMany({}),
  ]);

  // 2. Pre-hash universal password "Password123!" for all demo and staff accounts
  const passwordHash = await bcrypt.hash("Password123!", 10);

  // 3. Create Official CCC Municipal Departments
  console.log("🏛️ Creating 5 CCC Municipal Departments...");
  const departmentsData = [
    {
      name: "Road Maintenance Department",
      code: "ROAD",
      description: "Asphalt repairs, pothole remediation, speed governors, and roadway resurfacing across Chattogram metropolitan area.",
      contactEmail: "road.maintenance@civicpulse.com",
      contactPhone: "+880 31-610001",
      categories: ["Road Damage"],
      status: "active",
    },
    {
      name: "Electrical & Public Lighting Division",
      code: "ELEC",
      description: "Streetlights, high-mast illumination poles, junction boxes, and smart city sensor grids.",
      contactEmail: "lighting.division@civicpulse.com",
      contactPhone: "+880 31-610002",
      categories: ["Streetlight"],
      status: "active",
    },
    {
      name: "Water & Sewerage Authority (WASA)",
      code: "WASA",
      description: "Stormwater canals, culvert drainage, silt excavation, and floodwater drainage operations.",
      contactEmail: "drainage.wasa@civicpulse.com",
      contactPhone: "+880 31-610003",
      categories: ["Drainage"],
      status: "active",
    },
    {
      name: "Sidewalk & Civil Works",
      code: "CIVIL",
      description: "Pedestrian sidewalks, paving blocks, overpass walkways, guard rails, and public structures.",
      contactEmail: "civil.works@civicpulse.com",
      contactPhone: "+880 31-610004",
      categories: ["Footpath", "Public Infrastructure"],
      status: "active",
    },
    {
      name: "Waste & Sanitation Division",
      code: "WASTE",
      description: "Solid waste management, primary collection, secondary transfer stations, and recycling.",
      contactEmail: "sanitation@civicpulse.com",
      contactPhone: "+880 31-610005",
      categories: ["Waste Management"],
      status: "active",
    },
  ];

  const departments = await Department.insertMany(departmentsData);
  const deptMap = {};
  departments.forEach((d) => {
    deptMap[d.code] = d;
  });

  // 4. Create Core Users & Demo Accounts
  console.log("👥 Creating Demo Accounts, Department Managers & Field Technicians...");

  // 4.1 Demo Accounts
  const adminUser = await User.create({
    name: "Nazmul Haque (City Commissioner)",
    email: "admin@civicpulse.com",
    emailVerified: true,
    role: "admin",
    phone: "+880 1711-000001",
    image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
    isActive: true,
  });

  const roadManager = await User.create({
    name: "Engr. Farhana Ahmed",
    email: "manager@civicpulse.com",
    emailVerified: true,
    role: "manager",
    department: deptMap["ROAD"]._id,
    phone: "+880 1819-000002",
    image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
    isActive: true,
  });

  const demoStaff = await User.create({
    name: "Kabir Hossain (Lead Road Tech)",
    email: "staff@civicpulse.com",
    emailVerified: true,
    role: "staff",
    department: deptMap["ROAD"]._id,
    phone: "+880 1912-000010",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    isActive: true,
  });

  const demoCitizen = await User.create({
    name: "Tanvir Rahman",
    email: "citizen@civicpulse.com",
    emailVerified: true,
    role: "citizen",
    phone: "+880 1610-000020",
    image: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
    isActive: true,
  });

  // Assign Road Manager to Department
  deptMap["ROAD"].manager = roadManager._id;
  await Department.findByIdAndUpdate(deptMap["ROAD"]._id, { manager: roadManager._id });

  // 4.2 Additional Department Managers
  const managersData = [
    { name: "Engr. Tariqul Islam", email: "manager.elec@civicpulse.com", dept: "ELEC", phone: "+880 1819-000003" },
    { name: "Engr. Mahmudul Hasan", email: "manager.wasa@civicpulse.com", dept: "WASA", phone: "+880 1819-000004" },
    { name: "Engr. Shahnaz Parvin", email: "manager.civil@civicpulse.com", dept: "CIVIL", phone: "+880 1819-000005" },
    { name: "Kazi Rafiqul Alam", email: "manager.waste@civicpulse.com", dept: "WASTE", phone: "+880 1819-000006" },
  ];

  const createdManagers = [roadManager];
  for (const m of managersData) {
    const mgr = await User.create({
      name: m.name,
      email: m.email,
      emailVerified: true,
      role: "manager",
      department: deptMap[m.dept]._id,
      phone: m.phone,
      isActive: true,
    });
    deptMap[m.dept].manager = mgr._id;
    await Department.findByIdAndUpdate(deptMap[m.dept]._id, { manager: mgr._id });
    createdManagers.push(mgr);
  }

  // 4.3 20+ Maintenance Technicians
  const staffRoster = [
    // ROAD
    { name: "Monirul Islam", email: "staff.road1@civicpulse.com", dept: "ROAD", phone: "+880 1912-100001" },
    { name: "Shahidul Alam", email: "staff.road2@civicpulse.com", dept: "ROAD", phone: "+880 1912-100002" },
    { name: "Anisur Rahman", email: "staff.road3@civicpulse.com", dept: "ROAD", phone: "+880 1912-100003" },
    { name: "Babul Mia", email: "staff.road4@civicpulse.com", dept: "ROAD", phone: "+880 1912-100004" },
    // ELEC
    { name: "Abul Kalam", email: "staff.elec1@civicpulse.com", dept: "ELEC", phone: "+880 1912-200001" },
    { name: "Zahirul Haque", email: "staff.elec2@civicpulse.com", dept: "ELEC", phone: "+880 1912-200002" },
    { name: "Shafiqul Islam", email: "staff.elec3@civicpulse.com", dept: "ELEC", phone: "+880 1912-200003" },
    { name: "Delwar Hossain", email: "staff.elec4@civicpulse.com", dept: "ELEC", phone: "+880 1912-200004" },
    // WASA
    { name: "Jalal Uddin", email: "staff.wasa1@civicpulse.com", dept: "WASA", phone: "+880 1912-300001" },
    { name: "Kamrul Hasan", email: "staff.wasa2@civicpulse.com", dept: "WASA", phone: "+880 1912-300002" },
    { name: "Nurul Amin", email: "staff.wasa3@civicpulse.com", dept: "WASA", phone: "+880 1912-300003" },
    { name: "Sirajul Islam", email: "staff.wasa4@civicpulse.com", dept: "WASA", phone: "+880 1912-300004" },
    // CIVIL
    { name: "Mizanur Rahman", email: "staff.civil1@civicpulse.com", dept: "CIVIL", phone: "+880 1912-400001" },
    { name: "Rashedul Karim", email: "staff.civil2@civicpulse.com", dept: "CIVIL", phone: "+880 1912-400002" },
    { name: "Golam Mostafa", email: "staff.civil3@civicpulse.com", dept: "CIVIL", phone: "+880 1912-400003" },
    { name: "Harunur Rashid", email: "staff.civil4@civicpulse.com", dept: "CIVIL", phone: "+880 1912-400004" },
    // WASTE
    { name: "Sultan Mahmud", email: "staff.waste1@civicpulse.com", dept: "WASTE", phone: "+880 1912-500001" },
    { name: "Fazlur Rahman", email: "staff.waste2@civicpulse.com", dept: "WASTE", phone: "+880 1912-500002" },
    { name: "Khorshed Alam", email: "staff.waste3@civicpulse.com", dept: "WASTE", phone: "+880 1912-500003" },
    { name: "Liaquat Ali", email: "staff.waste4@civicpulse.com", dept: "WASTE", phone: "+880 1912-500004" },
  ];

  const allStaff = [demoStaff];
  for (const s of staffRoster) {
    const stf = await User.create({
      name: s.name,
      email: s.email,
      emailVerified: true,
      role: "staff",
      department: deptMap[s.dept]._id,
      phone: s.phone,
      isActive: true,
    });
    allStaff.push(stf);
  }

  // 4.4 Additional Citizens
  const citizensData = [
    { name: "Sadia Khan", email: "sadia.k@gmail.com", phone: "+880 1712-300011" },
    { name: "Arif Chowdhury", email: "arif.chowdhury@yahoo.com", phone: "+880 1712-300012" },
    { name: "Farzana Mahbub", email: "farzana.m@outlook.com", phone: "+880 1712-300013" },
    { name: "Imran Hossain", email: "imran.hossain@gmail.com", phone: "+880 1712-300014" },
    { name: "Nusrat Jahan", email: "nusrat.jahan@gmail.com", phone: "+880 1712-300015" },
    { name: "Rashidul Karim", email: "rashid.khan@gmail.com", phone: "+880 1712-300016" },
  ];

  const allCitizens = [demoCitizen];
  for (const c of citizensData) {
    const ctz = await User.create({
      name: c.name,
      email: c.email,
      emailVerified: true,
      role: "citizen",
      phone: c.phone,
      isActive: true,
    });
    allCitizens.push(ctz);
  }

  // 4.5 Insert Better Auth Credential Accounts for ALL users
  console.log("🔐 Provisioning Better Auth credential accounts (Password123!)...");
  const allUsers = [adminUser, ...createdManagers, ...allStaff, ...allCitizens];
  const accountsToInsert = allUsers.map((u) => ({
    userId: u._id.toString(),
    accountId: u._id.toString(),
    providerId: "credential",
    password: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.collection("account").insertMany(accountsToInsert);

  // 5. Generate 105 Geocoded Realistic Incidents
  console.log("📍 Generating 105 Geocoded Incidents across Chattogram metropolitan wards...");

  const CATEGORIES = [
    "Road Damage",
    "Streetlight",
    "Drainage",
    "Footpath",
    "Waste Management",
    "Public Infrastructure",
  ];

  const PRIORITIES = ["low", "medium", "high", "critical"];

  const DEPT_BY_CAT = {
    "Road Damage": deptMap["ROAD"],
    Streetlight: deptMap["ELEC"],
    Drainage: deptMap["WASA"],
    Footpath: deptMap["CIVIL"],
    "Public Infrastructure": deptMap["CIVIL"],
    "Waste Management": deptMap["WASTE"],
  };

  // Pre-calculate target status counts: 25 Submitted, 15 Under Review, 25 In Progress, 25 Resolved, 15 Closed
  const STATUS_TARGETS = [
    ...Array(25).fill("Submitted"),
    ...Array(15).fill("Under Review"),
    ...Array(25).fill("In Progress"),
    ...Array(25).fill("Resolved"),
    ...Array(15).fill("Closed"),
  ];

  const issuesCreated = [];
  const now = Date.now();

  for (let i = 0; i < STATUS_TARGETS.length; i++) {
    const status = STATUS_TARGETS[i];
    const category = CATEGORIES[i % CATEGORIES.length];
    const priority = PRIORITIES[i % PRIORITIES.length];
    const hub = CHATTOGRAM_HUBS[i % CHATTOGRAM_HUBS.length];
    const department = DEPT_BY_CAT[category];
    const reporter = allCitizens[i % allCitizens.length];

    // Jitter coordinates naturally within 1.2km radius
    const lngJitter = (Math.random() - 0.5) * 0.016;
    const latJitter = (Math.random() - 0.5) * 0.016;
    const coords = [
      parseFloat((hub.coords[0] + lngJitter).toFixed(6)),
      parseFloat((hub.coords[1] + latJitter).toFixed(6)),
    ];

    // Creation date spread across past 180 days
    const daysAgo = Math.floor(Math.random() * 180) + 1;
    const createdAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);

    const templates = ISSUE_TEMPLATES[category];
    const rawTitle = `${templates[i % templates.length]} (${hub.name})`;
    const title = rawTitle.length > 95 ? `${rawTitle.slice(0, 92)}...` : rawTitle;
    const description = `Incident reported at ${hub.address}. The hazard is severely affecting local residents and requires priority municipal intervention from the ${department.name}.`;

    const catImages = CATEGORY_IMAGES[category];
    const imageUrl = catImages[i % catImages.length];

    // Staff technician pool for this department
    const deptStaffPool = allStaff.filter(
      (s) => s.department && s.department.toString() === department._id.toString()
    );
    const assignedStaff = deptStaffPool.length > 0 ? deptStaffPool[i % deptStaffPool.length] : allStaff[0];

    const issueDoc = {
      title,
      description,
      category,
      priority,
      status,
      address: `${hub.name}, ${hub.ward}, Chattogram`,
      location: {
        type: "Point",
        coordinates: coords,
      },
      image: {
        url: imageUrl,
        publicId: `sample-issue-${i}`,
      },
      reporter: reporter._id,
      department: department._id,
      assignedTo: ["Assigned", "In Progress", "Resolved", "Closed"].includes(status) ? assignedStaff._id : null,
      verifiedBy: ["Under Review", "Assigned", "In Progress", "Resolved", "Closed"].includes(status) ? department.manager : null,
      resolvedAt: ["Resolved", "Closed"].includes(status) ? new Date(createdAt.getTime() + 48 * 3600000) : null,
      closedAt: status === "Closed" ? new Date(createdAt.getTime() + 72 * 3600000) : null,
      createdAt,
      updatedAt: new Date(createdAt.getTime() + 24 * 3600000),
    };

    const createdIssue = await Issue.create(issueDoc);
    issuesCreated.push(createdIssue);

    // 6. Relational History (IssueStatusHistory)
    await IssueStatusHistory.create({
      issue: createdIssue._id,
      fromStatus: null,
      toStatus: "Submitted",
      changedBy: reporter._id,
      note: "Initial citizen report submitted via CivicPulse mobile portal.",
      createdAt: createdAt,
    });

    if (["Under Review", "Assigned", "In Progress", "Resolved", "Closed"].includes(status)) {
      await IssueStatusHistory.create({
        issue: createdIssue._id,
        fromStatus: "Submitted",
        toStatus: "Under Review",
        changedBy: department.manager,
        note: `Verified by Department Manager. Priority set to ${priority.toUpperCase()}.`,
        createdAt: new Date(createdAt.getTime() + 4 * 3600000),
      });
    }

    if (["In Progress", "Resolved", "Closed"].includes(status)) {
      await IssueStatusHistory.create({
        issue: createdIssue._id,
        fromStatus: "Under Review",
        toStatus: "Assigned",
        changedBy: department.manager,
        note: `Assigned to field technician ${assignedStaff.name}.`,
        createdAt: new Date(createdAt.getTime() + 8 * 3600000),
      });

      await IssueStatusHistory.create({
        issue: createdIssue._id,
        fromStatus: "Assigned",
        toStatus: "In Progress",
        changedBy: assignedStaff._id,
        note: "Crew deployed on site. Heavy repair equipment active.",
        createdAt: new Date(createdAt.getTime() + 16 * 3600000),
      });

      // Create dispatched Task document
      const isTaskDone = ["Resolved", "Closed"].includes(status);
      await Task.create({
        issue: createdIssue._id,
        title: `Field Dispatch: ${createdIssue.title}`,
        instructions: `Proceed to ${createdIssue.address}. Conduct safety perimeter setup, resolve the infrastructure fault, and submit high-resolution photographic proof upon completion.`,
        department: department._id,
        assignedTo: assignedStaff._id,
        assignedBy: department.manager,
        status: isTaskDone ? "Completed" : "In Progress",
        priority: priority,
        progressReports: [
          {
            note: "Arrived at location. Safety cones deployed.",
            by: assignedStaff._id,
            createdAt: new Date(createdAt.getTime() + 17 * 3600000),
          },
          ...(isTaskDone
            ? [
                {
                  note: "Repairs finalized. Site cleaned and reopened for public usage.",
                  by: assignedStaff._id,
                  createdAt: new Date(createdAt.getTime() + 47 * 3600000),
                },
              ]
            : []),
        ],
        completionPhotos: isTaskDone
          ? [
              {
                url: COMPLETION_PROOF_IMAGES[i % COMPLETION_PROOF_IMAGES.length],
                publicId: `proof-task-${i}`,
              },
            ]
          : [],
        dueDate: new Date(createdAt.getTime() + 72 * 3600000),
        completedAt: isTaskDone ? new Date(createdAt.getTime() + 48 * 3600000) : null,
        createdAt: new Date(createdAt.getTime() + 8 * 3600000),
      });
    }

    if (["Resolved", "Closed"].includes(status)) {
      await IssueStatusHistory.create({
        issue: createdIssue._id,
        fromStatus: "In Progress",
        toStatus: "Resolved",
        changedBy: assignedStaff._id,
        note: "Repairs completed successfully with verified photographic evidence.",
        createdAt: new Date(createdAt.getTime() + 48 * 3600000),
      });

      // Citizen Feedback Rating
      const ratings = [4, 5, 5, 4, 3, 5, 4];
      const rating = ratings[i % ratings.length];
      const feedbackComments = [
        "Prompt repair! The road is now completely smooth and safe.",
        "Excellent response by the CCC team. Highly satisfied with the speed.",
        "Work was done within 48 hours. Thank you for the quick action!",
        "The drain was cleared properly before monsoon rainfall. Good job.",
        "Resolved effectively. Appreciate the transparency.",
      ];
      await Feedback.create({
        issue: createdIssue._id,
        citizen: reporter._id,
        department: department._id,
        rating,
        comment: feedbackComments[i % feedbackComments.length],
        createdAt: new Date(createdAt.getTime() + 52 * 3600000),
      });
    }

    if (status === "Closed") {
      await IssueStatusHistory.create({
        issue: createdIssue._id,
        fromStatus: "Resolved",
        toStatus: "Closed",
        changedBy: department.manager,
        note: "Case closed after positive citizen verification.",
        createdAt: new Date(createdAt.getTime() + 72 * 3600000),
      });
    }
  }

  // 7. Seed In-App Notifications for Demo Users
  console.log("🔔 Creating in-app alerts for demo accounts...");

  // Notifications for Citizen (demoCitizen)
  const citizenIssues = issuesCreated.filter((iss) => iss.reporter.toString() === demoCitizen._id.toString());
  if (citizenIssues.length > 0) {
    await Notification.create({
      user: demoCitizen._id,
      title: "Repair Work In Progress",
      message: `Your report #${citizenIssues[0]._id.toString().slice(-4).toUpperCase()} has been assigned to field technicians and work has commenced.`,
      type: "status_change",
      issue: citizenIssues[0]._id,
      isRead: false,
      createdAt: new Date(),
    });

    if (citizenIssues.length > 1) {
      await Notification.create({
        user: demoCitizen._id,
        title: "Incident Resolved & Verified",
        message: `Your incident report #${citizenIssues[1]._id.toString().slice(-4).toUpperCase()} is resolved! Please rate our service.`,
        type: "status_change",
        issue: citizenIssues[1]._id,
        isRead: false,
        createdAt: new Date(Date.now() - 3600000),
      });
    }
  }

  // Notifications for Staff (demoStaff)
  const staffTasks = await Task.find({ assignedTo: demoStaff._id }).limit(2);
  for (const t of staffTasks) {
    await Notification.create({
      user: demoStaff._id,
      title: "New Maintenance Task Assigned",
      message: `You have been dispatched for urgent repair at ${t.title}. View work instructions.`,
      type: "task_assigned",
      issue: t.issue,
      isRead: false,
      createdAt: new Date(),
    });
  }

  // Notifications for Manager (roadManager)
  await Notification.create({
    user: roadManager._id,
    title: "Citizen Feedback Received",
    message: "A 5-star citizen rating was submitted for resolved road repair in Agrabad.",
    type: "feedback_received",
    isRead: false,
    createdAt: new Date(),
  });

  // 8. Log initial operational Activity
  console.log("📝 Generating initial operational Activity Logs...");
  await ActivityLog.create({
    user: adminUser._id,
    action: "DATABASE_SEEDED",
    entityType: "System",
    entityId: adminUser._id,
    details: {
      departmentsCount: departments.length,
      usersCount: allUsers.length,
      issuesCount: issuesCreated.length,
      timestamp: new Date(),
    },
  });

  console.log("\n=======================================================");
  console.log("🎉 CivicPulse Database Seeding Completed Successfully!");
  console.log("=======================================================");
  console.log(`🏛️ Departments Created:  ${departments.length}`);
  console.log(`👥 Users Created:        ${allUsers.length} (Admins, Managers, Staff, Citizens)`);
  console.log(`📍 Issues Geocoded:      ${issuesCreated.length} (across 41 CCC Wards)`);
  console.log(`🔧 Dispatched Tasks:     ${await Task.countDocuments()}`);
  console.log(`⭐ Citizen Feedback:     ${await Feedback.countDocuments()}`);
  console.log("-------------------------------------------------------");
  console.log("🔑 DEMO CREDENTIALS (All passwords: Password123!)");
  console.log("   • Admin:      admin@civicpulse.com");
  console.log("   • Manager:    manager@civicpulse.com (Road Maintenance)");
  console.log("   • Staff:      staff@civicpulse.com   (Field Technician)");
  console.log("   • Citizen:    citizen@civicpulse.com");
  console.log("=======================================================\n");

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding Error:", err);
  process.exit(1);
});
