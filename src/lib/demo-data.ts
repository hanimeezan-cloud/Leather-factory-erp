import { PRODUCTION_STAGES } from "./domain";
import { calculateShipmentRisk } from "./production-intelligence";
import type {
  Approval,
  BomMaterial,
  Customer,
  DashboardMetrics,
  DailyLog,
  DailyUpdate,
  DominoWarning,
  Material,
  MaterialPoItem,
  MaterialPoEmailLog,
  MaterialPurchaseOrder,
  MaterialRequirement,
  ProductionLine,
  ProductionTimelineEvent,
  ProductionDepartment,
  ProductionStage,
  ProductionStageSummary,
  Profile,
  PurchaseOrder,
  PurchaseOrderSize,
  ReportType,
  Role,
  Vendor,
} from "./domain";

// DEMO ONLY: This file powers the factory-meeting demo without Supabase or an API.
// Do not use this as production authentication, authorization, or persistence.

const productionStageLabels: Record<ProductionStage, string> = {
  Cutting: "Cutting",
  Upper: "Upper",
  Bottom: "Bottom",
  Packing: "Packing",
};

const productionStageOrder: ProductionStage[] = [...PRODUCTION_STAGES];

function achievementPercent(actual: number, target: number) {
  return target ? Math.round((actual / target) * 100) : 0;
}

const SESSION_KEY = "fph.demo.session.v1";
const DATA_KEY = "fph.demo.data.v2";
const USER_KEY = "fph.demo.users.v1";

export interface DemoUser extends Profile {
  password: string;
}

export interface DemoData {
  customers: Customer[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderSizes: PurchaseOrderSize[];
  materials: Material[];
  bomMaterials: BomMaterial[];
  vendors: Vendor[];
  materialRequirements: MaterialRequirement[];
  materialPurchaseOrders: MaterialPurchaseOrder[];
  materialPoItems: MaterialPoItem[];
  materialPoEmailLogs: MaterialPoEmailLog[];
  approvals: Approval[];
  productionLines: ProductionLine[];
  dailyUpdates: DailyUpdate[];
  dailyLogs: DailyLog[];
  productionTimeline: ProductionTimelineEvent[];
}

let demoDataCache: DemoData | null = null;
let demoUsersCache: DemoUser[] | null = null;

export const demoUsers: DemoUser[] = [
  {
    userId: "demo-owner",
    email: "owner@factory.com",
    password: "password123",
    fullName: "Factory Owner",
    department: "Management",
    role: "Owner",
    active: true,
  },
  {
    userId: "demo-planning",
    email: "planning@factory.com",
    password: "password123",
    fullName: "Planning Lead",
    department: "Planning",
    role: "Planning",
    active: true,
  },
  {
    userId: "demo-production",
    email: "production@factory.com",
    password: "password123",
    fullName: "Production Supervisor",
    department: "Production",
    role: "Production",
    active: true,
  },
  {
    userId: "demo-sales",
    email: "sales@factory.com",
    password: "password123",
    fullName: "Sales Coordinator",
    department: "Sales",
    role: "Sales",
    active: true,
  },
];

const customers: Customer[] = [
  {
    id: "cust-aldo",
    customerName: "Aldo",
    brand: "Aldo",
    contactPerson: "Priya Menon",
    email: "priya.menon@aldo.example",
    phone: "+91 98765 41010",
    country: "Canada",
    status: "Active",
    notes: "Prefers weekly order progress summaries and photo approvals before packing.",
    createdAt: "2026-05-01T08:00:00.000Z",
    updatedAt: "2026-06-09T09:10:00.000Z",
  },
  {
    id: "cust-clarks",
    customerName: "Clarks",
    brand: "Clarks Originals",
    contactPerson: "James Walker",
    email: "j.walker@clarks.example",
    phone: "+44 20 7946 0188",
    country: "United Kingdom",
    status: "Active",
    notes: "Material approvals often need UK office confirmation.",
    createdAt: "2026-05-03T08:00:00.000Z",
    updatedAt: "2026-06-08T11:00:00.000Z",
  },
  {
    id: "cust-geox",
    customerName: "Geox",
    brand: "Geox",
    contactPerson: "Marco Bellini",
    email: "marco.bellini@geox.example",
    phone: "+39 041 123 4421",
    country: "Italy",
    status: "Active",
    notes: "Sensitive to delayed toe puff and sole component arrivals.",
    createdAt: "2026-05-04T08:00:00.000Z",
    updatedAt: "2026-06-10T14:20:00.000Z",
  },
  {
    id: "cust-ecco",
    customerName: "Ecco",
    brand: "Ecco",
    contactPerson: "Sofia Larsen",
    email: "sofia.larsen@ecco.example",
    phone: "+45 70 20 11 22",
    country: "Denmark",
    status: "Active",
    notes: "Upcoming order is in planning and needs line allocation.",
    createdAt: "2026-05-05T08:00:00.000Z",
    updatedAt: "2026-06-05T12:30:00.000Z",
  },
  {
    id: "cust-bata",
    customerName: "Bata",
    brand: "Bata School",
    contactPerson: "Ravi Shah",
    email: "ravi.shah@bata.example",
    phone: "+91 99887 76123",
    country: "India",
    status: "Active",
    notes: "Packing progress is the key meeting item this week.",
    createdAt: "2026-05-06T08:00:00.000Z",
    updatedAt: "2026-06-07T16:45:00.000Z",
  },
  {
    id: "cust-hush",
    customerName: "Hush Puppies",
    brand: "Hush Puppies",
    contactPerson: "Nadia Khan",
    email: "nadia.khan@hushpuppies.example",
    phone: "+971 4 555 0180",
    country: "UAE",
    status: "Active",
    notes: "Ready shipment awaiting warehouse handover.",
    createdAt: "2026-05-07T08:00:00.000Z",
    updatedAt: "2026-06-09T17:00:00.000Z",
  },
  {
    id: "cust-timberland",
    customerName: "Timberland",
    brand: "Timberland",
    contactPerson: "Chris Morgan",
    email: "chris.morgan@timberland.example",
    phone: "+1 617 555 0134",
    country: "United States",
    status: "Prospect",
    notes: "No active PO yet. Sampling conversation expected after the factory meeting.",
    createdAt: "2026-05-09T08:00:00.000Z",
    updatedAt: "2026-05-30T10:15:00.000Z",
  },
  {
    id: "cust-loake",
    customerName: "Loake",
    brand: "Loake Shoemakers",
    contactPerson: "Eleanor Hughes",
    email: "eleanor.hughes@loake.example",
    phone: "+44 1536 555 019",
    country: "United Kingdom",
    status: "Inactive",
    notes: "Completed previous formal shoe order. No active PO for the pilot week.",
    createdAt: "2026-04-18T08:00:00.000Z",
    updatedAt: "2026-05-24T10:15:00.000Z",
  },
];

const purchaseOrders: PurchaseOrder[] = [
  {
    id: "po-1",
    customerId: "cust-aldo",
    customerName: "Aldo",
    poNumber: "PO-2026-001",
    buyer: "Aldo",
    poDate: "2026-05-23",
    article: "Derby 3421",
    brand: "Aldo",
    styleCode: "ALD-3421",
    styleName: "Derby Formal",
    color: "Tan Brown",
    quantity: 1200,
    price: 28.5,
    currency: "USD",
    deliveryDate: "2026-06-18",
    status: "Production Running",
    notes: "Upper closing on schedule.",
    productImageUrl: "",
    approved: true,
    approvedBy: "demo-owner",
    approvedByName: "Factory Owner",
    approvedDate: "2026-05-27T09:30:00.000Z",
    currentStage: "Bottom",
    styleId: "style-ald-3421",
    assignedProductionLineId: "line-2",
    assignedLastingLineId: "line-4",
    plannedStartDate: "2026-06-10",
    plannedDailyCapacity: 600,
    estimatedLastingDays: 2,
    estimatedCompletionDate: "2026-06-11",
    shipmentRisk: "Low",
    productionPlanSummary: "Bottom Line 01 can finish estimated lasting in 2 day(s).",
    dominoWarnings: [],
  },
  {
    id: "po-2",
    customerId: "cust-clarks",
    customerName: "Clarks",
    poNumber: "PO-2026-002",
    buyer: "Clarks",
    poDate: "2026-05-25",
    article: "Oxford 9912",
    brand: "Clarks Originals",
    styleCode: "CLK-9912",
    styleName: "Oxford Classic",
    color: "Black",
    quantity: 800,
    price: 31.25,
    currency: "USD",
    deliveryDate: "2026-06-15",
    status: "Materials Pending",
    notes: "Waiting for sole confirmation.",
    productImageUrl: "",
    approved: false,
    currentStage: "Cutting",
    styleId: "style-clk-9912",
    dominoWarnings: [
      {
        code: "missing_lasting_capacity",
        message: "Assigned lasting line or daily capacity is missing.",
        severity: "warning",
      },
      {
        code: "missing_vendor",
        message: "Some material requirements do not have a vendor assigned.",
        severity: "warning",
      },
    ],
  },
  {
    id: "po-3",
    customerId: "cust-geox",
    customerName: "Geox",
    poNumber: "PO-2026-003",
    buyer: "Geox",
    poDate: "2026-05-20",
    article: "Cushion 5588",
    brand: "Geox",
    styleCode: "GEO-5588",
    styleName: "Cushion Loafer",
    color: "Cognac",
    quantity: 600,
    price: 34,
    currency: "USD",
    deliveryDate: "2026-06-11",
    status: "Delayed",
    notes: "Toe puff shipment delayed.",
    productImageUrl: "",
    approved: false,
    currentStage: "Upper",
  },
  {
    id: "po-4",
    customerId: "cust-ecco",
    customerName: "Ecco",
    poNumber: "PO-2026-004",
    buyer: "Ecco",
    poDate: "2026-06-01",
    article: "Comfort 7723",
    brand: "Ecco",
    styleCode: "ECC-7723",
    styleName: "Comfort Slip-on",
    color: "Dark Olive",
    quantity: 1500,
    price: 36.75,
    currency: "USD",
    deliveryDate: "2026-07-02",
    status: "Planning",
    notes: "Line allocation under review.",
    productImageUrl: "",
    approved: false,
    currentStage: "Cutting",
  },
  {
    id: "po-5",
    customerId: "cust-bata",
    customerName: "Bata",
    poNumber: "PO-2026-005",
    buyer: "Bata",
    poDate: "2026-05-29",
    article: "School 1102",
    brand: "Bata School",
    styleCode: "BAT-1102",
    styleName: "School Shoe",
    color: "White",
    quantity: 2000,
    price: 14.8,
    currency: "USD",
    deliveryDate: "2026-06-25",
    status: "Packing",
    notes: "Packing target increased for dispatch.",
    productImageUrl: "",
    approved: true,
    approvedBy: "demo-planning",
    approvedByName: "Planning Lead",
    approvedDate: "2026-06-01T10:45:00.000Z",
    currentStage: "Packing",
  },
  {
    id: "po-6",
    customerId: "cust-hush",
    customerName: "Hush Puppies",
    poNumber: "PO-2026-006",
    buyer: "Hush Puppies",
    poDate: "2026-05-18",
    article: "Moc 4410",
    brand: "Hush Puppies",
    styleCode: "HP-4410",
    styleName: "Casual Moc",
    color: "Chestnut",
    quantity: 950,
    price: 29.9,
    currency: "USD",
    deliveryDate: "2026-06-09",
    status: "Ready To Ship",
    notes: "Awaiting warehouse handover.",
    productImageUrl: "",
    approved: true,
    approvedBy: "demo-owner",
    approvedByName: "Factory Owner",
    approvedDate: "2026-05-22T11:00:00.000Z",
    currentStage: "Completed",
  },
  {
    id: "po-7",
    customerId: "cust-loake",
    customerName: "Loake",
    poNumber: "PO-2026-000",
    buyer: "Loake",
    poDate: "2026-04-16",
    article: "Formal 6810",
    brand: "Loake Shoemakers",
    styleCode: "LOK-6810",
    styleName: "Cap Toe Derby",
    color: "Burgundy",
    quantity: 500,
    price: 42,
    currency: "USD",
    deliveryDate: "2026-05-24",
    status: "Shipped",
    notes: "Completed and shipped before the pilot week.",
    productImageUrl: "",
    approved: true,
    approvedBy: "demo-owner",
    approvedByName: "Factory Owner",
    approvedDate: "2026-04-18T11:00:00.000Z",
    currentStage: "Completed",
  },
];

const purchaseOrderSizes: PurchaseOrderSize[] = [
  { id: "size-1", purchaseOrderId: "po-1", size: "40", quantity: 180 },
  { id: "size-2", purchaseOrderId: "po-1", size: "41", quantity: 240 },
  { id: "size-3", purchaseOrderId: "po-1", size: "42", quantity: 300 },
  { id: "size-4", purchaseOrderId: "po-1", size: "43", quantity: 270 },
  { id: "size-5", purchaseOrderId: "po-1", size: "44", quantity: 210 },
  { id: "size-6", purchaseOrderId: "po-2", size: "39", quantity: 100 },
  { id: "size-7", purchaseOrderId: "po-2", size: "40", quantity: 180 },
  { id: "size-8", purchaseOrderId: "po-2", size: "41", quantity: 220 },
  { id: "size-9", purchaseOrderId: "po-2", size: "42", quantity: 180 },
  { id: "size-10", purchaseOrderId: "po-2", size: "43", quantity: 120 },
  { id: "size-11", purchaseOrderId: "po-3", size: "40", quantity: 120 },
  { id: "size-12", purchaseOrderId: "po-3", size: "41", quantity: 140 },
  { id: "size-13", purchaseOrderId: "po-3", size: "42", quantity: 170 },
  { id: "size-14", purchaseOrderId: "po-3", size: "43", quantity: 130 },
  { id: "size-15", purchaseOrderId: "po-4", size: "39", quantity: 250 },
  { id: "size-16", purchaseOrderId: "po-4", size: "40", quantity: 300 },
  { id: "size-17", purchaseOrderId: "po-4", size: "41", quantity: 300 },
  { id: "size-18", purchaseOrderId: "po-4", size: "42", quantity: 300 },
  { id: "size-19", purchaseOrderId: "po-4", size: "43", quantity: 250 },
  { id: "size-20", purchaseOrderId: "po-5", size: "4", quantity: 400 },
  { id: "size-21", purchaseOrderId: "po-5", size: "5", quantity: 450 },
  { id: "size-22", purchaseOrderId: "po-5", size: "6", quantity: 450 },
  { id: "size-23", purchaseOrderId: "po-5", size: "7", quantity: 400 },
  { id: "size-24", purchaseOrderId: "po-5", size: "8", quantity: 300 },
  { id: "size-25", purchaseOrderId: "po-6", size: "40", quantity: 150 },
  { id: "size-26", purchaseOrderId: "po-6", size: "41", quantity: 220 },
  { id: "size-27", purchaseOrderId: "po-6", size: "42", quantity: 260 },
  { id: "size-28", purchaseOrderId: "po-6", size: "43", quantity: 200 },
  { id: "size-29", purchaseOrderId: "po-6", size: "44", quantity: 120 },
  { id: "size-30", purchaseOrderId: "po-7", size: "41", quantity: 120 },
  { id: "size-31", purchaseOrderId: "po-7", size: "42", quantity: 160 },
  { id: "size-32", purchaseOrderId: "po-7", size: "43", quantity: 140 },
  { id: "size-33", purchaseOrderId: "po-7", size: "44", quantity: 80 },
];

const bomMaterials: BomMaterial[] = [
  {
    id: "bom-1",
    styleId: "style-ald-3421",
    styleCode: "ALD-3421",
    styleName: "Derby Formal",
    color: "Tan Brown",
    brand: "Aldo",
    sizeRange: "40-44",
    category: "Upper",
    materialName: "Full Grain Leather",
    specification: "1.4 mm tan leather",
    supplier: "Tata Leather Co.",
    unit: "sq ft",
    consumptionPerPair: 2.4,
    wastagePercent: 8,
    criticality: "Yes",
    notes: "Customer shade approval complete.",
    defaultVendorId: "vendor-leather",
    defaultVendorName: "Tata Leather Co.",
  },
  {
    id: "bom-2",
    styleId: "style-ald-3421",
    styleCode: "ALD-3421",
    styleName: "Derby Formal",
    color: "Tan Brown",
    brand: "Aldo",
    sizeRange: "40-44",
    category: "Sole",
    materialName: "TPR Sole",
    specification: "Derby outsole mould",
    supplier: "SolePro Industries",
    unit: "pairs",
    consumptionPerPair: 1,
    wastagePercent: 2,
    calculationType: "Size Wise",
    criticality: "No",
    notes: "",
    defaultVendorId: "vendor-solepro",
    defaultVendorName: "SolePro Industries",
  },
  {
    id: "bom-3",
    styleId: "style-clk-9912",
    styleCode: "CLK-9912",
    styleName: "Oxford Classic",
    color: "Black",
    brand: "Clarks Originals",
    sizeRange: "39-43",
    category: "Lining",
    materialName: "Pigskin Lining",
    specification: "Black lining",
    supplier: "Comfort Linings",
    unit: "sq ft",
    consumptionPerPair: 1.8,
    wastagePercent: 6,
    criticality: "Yes",
    notes: "Imported style-level BOM sample.",
    defaultVendorId: "",
    defaultVendorName: "",
  },
];

const vendors: Vendor[] = [
  {
    id: "vendor-leather",
    vendorName: "Tata Leather Co.",
    contactPerson: "Anil Rao",
    email: "orders@tataleather.example",
    phone: "+91 98765 12121",
    address: "Chennai Leather Cluster, Tamil Nadu",
    materialCategories: ["Upper", "Leather"],
    notes: "Preferred leather supplier for formal styles.",
    status: "Active",
  },
  {
    id: "vendor-solepro",
    vendorName: "SolePro Industries",
    contactPerson: "Meera Joshi",
    email: "dispatch@solepro.example",
    phone: "+91 98400 44332",
    address: "Ambur Industrial Area, Tamil Nadu",
    materialCategories: ["Sole", "Bottom"],
    notes: "TPR and outsole mould supplier.",
    status: "Active",
  },
  {
    id: "vendor-packright",
    vendorName: "PackRight",
    contactPerson: "Sanjay Patel",
    email: "sales@packright.example",
    phone: "+91 98111 90909",
    address: "Noida Packaging Park",
    materialCategories: ["Packaging"],
    notes: "Boxes and carton supplier.",
    status: "Active",
  },
  {
    id: "vendor-comfort-linings",
    vendorName: "Comfort Linings",
    contactPerson: "Farah Khan",
    email: "orders@comfortlinings.example",
    phone: "+91 98222 11888",
    address: "Ranipet Material Park",
    materialCategories: ["Lining", "Insole"],
    notes: "Lining, foam and insole materials.",
    status: "Active",
  },
  {
    id: "vendor-trimline",
    vendorName: "TrimLine Accessories",
    contactPerson: "Rahul Sethi",
    email: "dispatch@trimline.example",
    phone: "+91 98000 77221",
    address: "Bengaluru Trim Market",
    materialCategories: ["Lace", "Label", "Thread"],
    notes: "Labels, laces and trims supplier.",
    status: "Active",
  },
  {
    id: "vendor-bondchem",
    vendorName: "BondChem",
    contactPerson: "Latha Iyer",
    email: "orders@bondchem.example",
    phone: "+91 97979 41012",
    address: "Pune Chemicals Estate",
    materialCategories: ["Adhesive", "Chemical"],
    notes: "Adhesives and finishing chemicals.",
    status: "Active",
  },
];

const materialRequirements: MaterialRequirement[] = [
  {
    id: "req-po1-bom1",
    purchaseOrderId: "po-1",
    customerId: "cust-aldo",
    styleId: "style-ald-3421",
    bomMaterialId: "bom-1",
    materialName: "Full Grain Leather",
    specification: "1.4 mm tan leather",
    requiredQuantity: 3110.4,
    orderedQuantity: 0,
    receivedQuantity: 0,
    balanceQuantity: 3110.4,
    unit: "sq ft",
    vendorId: "vendor-leather",
    vendorName: "Tata Leather Co.",
    quantityStatus: "Calculated",
    notes: "",
  },
  {
    id: "req-po1-bom2",
    purchaseOrderId: "po-1",
    customerId: "cust-aldo",
    styleId: "style-ald-3421",
    bomMaterialId: "bom-2",
    materialName: "TPR Sole",
    specification: "Derby outsole mould",
    requiredQuantity: 1224,
    orderedQuantity: 0,
    receivedQuantity: 0,
    balanceQuantity: 1224,
    unit: "pairs",
    vendorId: "vendor-solepro",
    vendorName: "SolePro Industries",
    quantityStatus: "Calculated",
    notes: "",
  },
];

const materialPoItems: MaterialPoItem[] = [
  {
    id: "mpoi-po1-leather-1",
    materialPoId: "mpo-po1-leather",
    materialRequirementId: "req-po1-bom1",
    materialName: "Full Grain Leather",
    specification: "1.4 mm tan leather",
    quantity: 3110.4,
    unit: "sq ft",
    vendorNameSnapshot: "Tata Leather Co.",
    notes: "",
  },
  {
    id: "mpoi-po1-sole-1",
    materialPoId: "mpo-po1-sole",
    materialRequirementId: "req-po1-bom2",
    materialName: "TPR Sole",
    specification: "Derby outsole mould",
    quantity: 1224,
    unit: "pairs",
    vendorNameSnapshot: "SolePro Industries",
    notes: "",
  },
];

const materialPurchaseOrders: MaterialPurchaseOrder[] = [
  {
    id: "mpo-po1-leather",
    materialPoNumber: "MPO-2026-0001",
    vendorId: "vendor-leather",
    vendorName: "Tata Leather Co.",
    customerId: "cust-aldo",
    customerName: "Aldo",
    purchaseOrderId: "po-1",
    poNumber: "PO-2026-001",
    styleId: "style-ald-3421",
    styleCode: "ALD-3421",
    color: "Tan Brown",
    generatedDate: "2026-06-13",
    expectedDeliveryDate: "2026-06-18",
    status: "Draft",
    notes: "",
    warnings: [],
    itemCount: 1,
    items: [materialPoItems[0]],
  },
  {
    id: "mpo-po1-sole",
    materialPoNumber: "MPO-2026-0002",
    vendorId: "vendor-solepro",
    vendorName: "SolePro Industries",
    customerId: "cust-aldo",
    customerName: "Aldo",
    purchaseOrderId: "po-1",
    poNumber: "PO-2026-001",
    styleId: "style-ald-3421",
    styleCode: "ALD-3421",
    color: "Tan Brown",
    generatedDate: "2026-06-13",
    expectedDeliveryDate: "2026-06-18",
    status: "Draft",
    notes: "",
    warnings: [],
    itemCount: 1,
    items: [materialPoItems[1]],
  },
];

const scalableStyleProfiles = [
  {
    styleId: "style-scale-aldo-5001",
    styleCode: "ALD-5001",
    styleName: "City Sneaker",
    color: "Black",
    brand: "Aldo",
    customerId: "cust-aldo",
    customerName: "Aldo",
  },
  {
    styleId: "style-scale-clarks-6202",
    styleCode: "CLK-6202",
    styleName: "Travel Oxford",
    color: "Brown",
    brand: "Clarks Originals",
    customerId: "cust-clarks",
    customerName: "Clarks",
  },
  {
    styleId: "style-scale-bata-3104",
    styleCode: "BAT-3104",
    styleName: "School Derby",
    color: "Black",
    brand: "Bata School",
    customerId: "cust-bata",
    customerName: "Bata",
  },
  {
    styleId: "style-scale-ecco-8807",
    styleCode: "ECC-8807",
    styleName: "Comfort Lace-up",
    color: "Navy",
    brand: "Ecco",
    customerId: "cust-ecco",
    customerName: "Ecco",
  },
] as const;

const scalableMaterialTemplates = [
  {
    category: "Upper",
    materialName: "Full Grain Leather",
    specification: "Factory approved shade",
    unit: "sq ft",
    consumptionPerPair: 2.35,
    wastagePercent: 8,
    vendorId: "vendor-leather",
    vendorName: "Tata Leather Co.",
  },
  {
    category: "Sole",
    materialName: "TPR Sole",
    specification: "Customer mould",
    unit: "pairs",
    consumptionPerPair: 1,
    wastagePercent: 2,
    calculationType: "Size Wise",
    vendorId: "vendor-solepro",
    vendorName: "SolePro Industries",
  },
  {
    category: "Lining",
    materialName: "Textile Lining",
    specification: "Breathable lining",
    unit: "sq ft",
    consumptionPerPair: 1.65,
    wastagePercent: 5,
    vendorId: "vendor-comfort-linings",
    vendorName: "Comfort Linings",
  },
  {
    category: "Insole",
    materialName: "Insole Board",
    specification: "2.0 mm board",
    unit: "pairs",
    consumptionPerPair: 1,
    wastagePercent: 3,
    vendorId: "vendor-comfort-linings",
    vendorName: "Comfort Linings",
  },
  {
    category: "Packaging",
    materialName: "Shoe Box",
    specification: "Customer printed box",
    unit: "pcs",
    consumptionPerPair: 1,
    wastagePercent: 1,
    vendorId: "vendor-packright",
    vendorName: "PackRight",
  },
  {
    category: "Trim",
    materialName: "Cotton Lace",
    specification: "90 cm lace",
    unit: "pairs",
    consumptionPerPair: 1,
    wastagePercent: 4,
    vendorId: "vendor-trimline",
    vendorName: "TrimLine Accessories",
  },
  {
    category: "Label",
    materialName: "Woven Label",
    specification: "Brand label",
    unit: "pcs",
    consumptionPerPair: 2,
    wastagePercent: 2,
    vendorId: "vendor-trimline",
    vendorName: "TrimLine Accessories",
  },
  {
    category: "Adhesive",
    materialName: "PU Adhesive",
    specification: "Lasting adhesive",
    unit: "kg",
    consumptionPerPair: 0.045,
    wastagePercent: 6,
    vendorId: "vendor-bondchem",
    vendorName: "BondChem",
  },
] as const;

function addDemoDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function roundDemoQuantity(value: number) {
  return Math.round(value * 100) / 100;
}

function buildScalableDemoData() {
  const bomMaterials: BomMaterial[] = scalableStyleProfiles.flatMap((style) =>
    scalableMaterialTemplates.map((template, index) => ({
      id: `bom-scale-${style.styleId}-${index + 1}`,
      styleId: style.styleId,
      styleCode: style.styleCode,
      styleName: style.styleName,
      color: style.color,
      brand: style.brand,
      sizeRange: "39-44",
      category: template.category,
      materialName: template.materialName,
      specification: template.specification,
      supplier: template.vendorName,
      unit: template.unit,
      consumptionPerPair: template.consumptionPerPair,
      wastagePercent: template.wastagePercent,
      criticality: index <= 2 ? "Yes" : "No",
      notes: "Scalable demo BOM row.",
      defaultVendorId: template.vendorId,
      defaultVendorName: template.vendorName,
    })),
  );

  const purchaseOrders: PurchaseOrder[] = Array.from({ length: 30 }, (_, index) => {
    const style = scalableStyleProfiles[index % scalableStyleProfiles.length];
    const quantity = 420 + ((index * 37) % 580);
    const status =
      index % 11 === 0
        ? "Delayed"
        : index % 7 === 0
          ? "Materials Pending"
          : index % 5 === 0
            ? "Packing"
            : "Production Running";
    const currentStage = PRODUCTION_STAGES[index % PRODUCTION_STAGES.length];
    return {
      id: `po-scale-${String(index + 1).padStart(3, "0")}`,
      customerId: style.customerId,
      customerName: style.customerName,
      poNumber: `PO-2026-S${String(index + 1).padStart(3, "0")}`,
      buyer: style.customerName,
      poDate: addDemoDays("2026-05-20", index % 14),
      article: style.styleName,
      brand: style.brand,
      styleCode: style.styleCode,
      styleName: style.styleName,
      color: style.color,
      quantity,
      price: 18 + (index % 12),
      currency: "USD",
      deliveryDate: addDemoDays("2026-06-18", index),
      status,
      notes: "Scalable demo order for material planning performance checks.",
      productImageUrl: "",
      approved: index % 4 !== 0,
      approvedBy: index % 4 !== 0 ? "demo-planning" : "",
      approvedByName: index % 4 !== 0 ? "Planning Lead" : "",
      approvedDate: index % 4 !== 0 ? "2026-06-03T10:00:00.000Z" : "",
      currentStage,
      styleId: style.styleId,
      plannedStartDate: addDemoDays("2026-06-08", index % 10),
      plannedDailyCapacity: 500,
      estimatedLastingDays: Math.max(Math.ceil(quantity / 500), 1),
      estimatedCompletionDate: addDemoDays("2026-06-08", (index % 10) + Math.ceil(quantity / 500)),
      shipmentRisk: index % 11 === 0 ? "High" : index % 7 === 0 ? "Medium" : "Low",
      productionPlanSummary: "Scalable demo production estimate generated from stage plan.",
      dominoWarnings:
        index % 9 === 0
          ? [
              {
                code: "missing_vendor",
                message: "One material requirement has no vendor assigned.",
                severity: "warning",
              },
            ]
          : [],
    };
  });

  const purchaseOrderSizes: PurchaseOrderSize[] = purchaseOrders.flatMap((order, orderIndex) => {
    const sizes = ["39", "40", "41", "42", "43", "44"];
    const base = Math.floor(order.quantity / sizes.length);
    let remainder = order.quantity - base * sizes.length;
    return sizes.map((size, sizeIndex) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return {
        id: `size-${order.id}-${size}`,
        purchaseOrderId: order.id,
        size,
        quantity: base + extra + (sizeIndex === orderIndex % sizes.length ? 0 : 0),
      };
    });
  });

  const materialRequirements: MaterialRequirement[] = [];
  const materialPoItems: MaterialPoItem[] = [];
  const materialPurchaseOrders: MaterialPurchaseOrder[] = [];
  let materialPoSequence = 3;

  for (const [orderIndex, order] of purchaseOrders.entries()) {
    const matchingBomMaterials = bomMaterials.filter((item) => item.styleId === order.styleId);
    for (const [materialIndex, bom] of matchingBomMaterials.entries()) {
      const isUnassigned = orderIndex % 9 === 0 && materialIndex === 5;
      const requiredQuantity = roundDemoQuantity(
        order.quantity * bom.consumptionPerPair * (1 + bom.wastagePercent / 100),
      );
      const orderedQuantity =
        orderIndex % 6 === 0 ? roundDemoQuantity(requiredQuantity * 0.6) : requiredQuantity;
      const receivedQuantity =
        orderIndex % 10 === 0 ? roundDemoQuantity(requiredQuantity * 0.25) : 0;
      materialRequirements.push({
        id: `req-${order.id}-${bom.id}`,
        purchaseOrderId: order.id,
        customerId: order.customerId,
        styleId: order.styleId ?? "",
        bomMaterialId: bom.id,
        materialName: bom.materialName,
        specification: bom.specification,
        requiredQuantity,
        orderedQuantity,
        receivedQuantity,
        balanceQuantity: Math.max(roundDemoQuantity(requiredQuantity - receivedQuantity), 0),
        unit: bom.unit,
        vendorId: isUnassigned ? "" : (bom.defaultVendorId ?? ""),
        vendorName: isUnassigned ? "" : (bom.defaultVendorName ?? ""),
        quantityStatus:
          materialIndex === 7 && orderIndex % 13 === 0 ? "Needs manual quantity" : "Calculated",
        notes: "",
      });
    }

    const orderRequirements = materialRequirements.filter(
      (item) => item.purchaseOrderId === order.id,
    );
    const requirementsByVendor = new Map<string, MaterialRequirement[]>();
    for (const requirement of orderRequirements) {
      const key = requirement.vendorId || "unassigned";
      const rows = requirementsByVendor.get(key) ?? [];
      rows.push(requirement);
      requirementsByVendor.set(key, rows);
    }

    for (const [vendorKey, rows] of requirementsByVendor.entries()) {
      const materialPoId = `mpo-${order.id}-${vendorKey}`;
      const vendorName = rows[0]?.vendorName || "Unassigned Vendor";
      const materialPo: MaterialPurchaseOrder = {
        id: materialPoId,
        materialPoNumber: `MPO-2026-${String(materialPoSequence++).padStart(4, "0")}`,
        vendorId: vendorKey === "unassigned" ? "" : vendorKey,
        vendorName,
        customerId: order.customerId,
        customerName: order.customerName,
        purchaseOrderId: order.id,
        poNumber: order.poNumber,
        styleId: order.styleId ?? "",
        styleCode: order.styleCode,
        color: order.color,
        generatedDate: "2026-06-13",
        expectedDeliveryDate: order.deliveryDate,
        status: "Draft",
        notes: "",
        warnings:
          vendorKey === "unassigned"
            ? [
                {
                  code: "missing_vendor",
                  message: "This draft contains requirements without an assigned vendor.",
                  severity: "warning",
                },
              ]
            : [],
        itemCount: rows.length,
      };
      const items = rows.map((requirement) => ({
        id: `mpoi-${materialPoId}-${requirement.id}`,
        materialPoId,
        materialRequirementId: requirement.id,
        materialName: requirement.materialName,
        specification: requirement.specification,
        quantity: requirement.requiredQuantity,
        unit: requirement.unit,
        vendorNameSnapshot: vendorName,
        notes: "",
      }));
      materialPoItems.push(...items);
      materialPurchaseOrders.push({ ...materialPo, items });
    }
  }

  return {
    purchaseOrders,
    purchaseOrderSizes,
    bomMaterials,
    materialRequirements,
    materialPurchaseOrders,
    materialPoItems,
  };
}

const scalableDemoData = buildScalableDemoData();

const baseProductionTimeline: ProductionTimelineEvent[] = [
  {
    id: "timeline-po-1-imported",
    purchaseOrderId: "po-1",
    poNumber: "PO-2026-001",
    customerName: "Aldo",
    styleCode: "ALD-3421",
    eventType: "po_imported",
    eventTitle: "PO Imported",
    eventDescription: "Standard customer PO was imported with size breakdown.",
    userId: "demo-planning",
    userName: "Planning Lead",
    createdAt: "2026-06-05T08:10:00.000Z",
  },
  {
    id: "timeline-po-1-bom",
    purchaseOrderId: "po-1",
    poNumber: "PO-2026-001",
    customerName: "Aldo",
    styleCode: "ALD-3421",
    eventType: "bom_linked",
    eventTitle: "BOM Linked",
    eventDescription: "Matching ALD-3421 / Tan Brown BOM linked automatically.",
    userId: "demo-planning",
    userName: "Planning Lead",
    createdAt: "2026-06-05T08:12:00.000Z",
  },
  {
    id: "timeline-po-1-materials",
    purchaseOrderId: "po-1",
    poNumber: "PO-2026-001",
    customerName: "Aldo",
    styleCode: "ALD-3421",
    eventType: "material_requirements_generated",
    eventTitle: "Material Requirements Generated",
    eventDescription: "Material requirements and draft vendor material POs were prepared.",
    userId: "demo-planning",
    userName: "Planning Lead",
    createdAt: "2026-06-05T08:13:00.000Z",
  },
  {
    id: "timeline-po-1-stage",
    purchaseOrderId: "po-1",
    poNumber: "PO-2026-001",
    customerName: "Aldo",
    styleCode: "ALD-3421",
    eventType: "stage_changed",
    eventTitle: "Moved to Bottom",
    eventDescription: "Upper checks completed and order moved to Bottom.",
    userId: "demo-production",
    userName: "Production Supervisor",
    createdAt: "2026-06-06T10:10:00.000Z",
  },
  {
    id: "timeline-po-2-vendor",
    purchaseOrderId: "po-2",
    poNumber: "PO-2026-002",
    customerName: "Clarks",
    styleCode: "CLK-9912",
    eventType: "vendor_assigned",
    eventTitle: "Vendor Assigned",
    eventDescription: "Leather vendor assigned; outsole vendor still needs confirmation.",
    userId: "demo-purchasing",
    userName: "Purchasing",
    createdAt: "2026-06-06T08:35:00.000Z",
  },
  {
    id: "timeline-po-2-shortage",
    purchaseOrderId: "po-2",
    poNumber: "PO-2026-002",
    customerName: "Clarks",
    styleCode: "CLK-9912",
    eventType: "domino_warning",
    eventTitle: "Material Shortage Noted",
    eventDescription: "Outsole material is still pending vendor confirmation.",
    userId: "demo-planning",
    userName: "Planning Lead",
    createdAt: "2026-06-06T08:40:00.000Z",
  },
  {
    id: "timeline-po-5-stage",
    purchaseOrderId: "po-5",
    poNumber: "PO-2026-005",
    customerName: "Bata",
    styleCode: "BAT-1102",
    eventType: "stage_changed",
    eventTitle: "Moved to Packing",
    eventDescription: "Bottom work completed and packing started.",
    userId: "demo-production",
    userName: "Production Supervisor",
    createdAt: "2026-06-06T07:30:00.000Z",
  },
];

const scalableProductionTimeline: ProductionTimelineEvent[] =
  scalableDemoData.purchaseOrders.flatMap((order, index) => [
    {
      id: `timeline-${order.id}-created`,
      purchaseOrderId: order.id,
      poNumber: order.poNumber,
      customerName: order.customerName,
      styleCode: order.styleCode,
      eventType: "po_imported",
      eventTitle: "PO Imported",
      eventDescription: "Standard template import saved this purchase order.",
      userId: "demo-planning",
      userName: "Planning Lead",
      createdAt: addDemoDays("2026-06-01", index % 5) + "T08:00:00.000Z",
    },
    {
      id: `timeline-${order.id}-stage`,
      purchaseOrderId: order.id,
      poNumber: order.poNumber,
      customerName: order.customerName,
      styleCode: order.styleCode,
      eventType: "stage_changed",
      eventTitle:
        order.currentStage === "Completed" ? "Completed" : `Moved to ${order.currentStage}`,
      eventDescription: `Order is currently in ${order.currentStage}.`,
      userId: "demo-production",
      userName: "Production Supervisor",
      createdAt: addDemoDays("2026-06-06", index % 4) + "T10:30:00.000Z",
    },
  ]);

const seedData: DemoData = {
  customers,
  purchaseOrders: [...purchaseOrders, ...scalableDemoData.purchaseOrders],
  purchaseOrderSizes: [...purchaseOrderSizes, ...scalableDemoData.purchaseOrderSizes],
  bomMaterials: [...bomMaterials, ...scalableDemoData.bomMaterials],
  vendors,
  materialRequirements: [...materialRequirements, ...scalableDemoData.materialRequirements],
  materialPurchaseOrders: [...materialPurchaseOrders, ...scalableDemoData.materialPurchaseOrders],
  materialPoItems: [...materialPoItems, ...scalableDemoData.materialPoItems],
  materialPoEmailLogs: [],
  materials: [
    {
      id: "mat-1",
      name: "Full Grain Leather",
      supplier: "Tata Leather Co.",
      poNumber: "PO-2026-001",
      requiredQty: 1450,
      receivedQty: 1450,
      unit: "sq ft",
      status: "Received",
      expectedArrival: "2026-05-28",
      actualArrival: "2026-05-27",
    },
    {
      id: "mat-2",
      name: "TPR Soles",
      supplier: "SolePro Industries",
      poNumber: "PO-2026-002",
      requiredQty: 800,
      receivedQty: 520,
      unit: "pairs",
      status: "In Transit",
      expectedArrival: "2026-06-08",
      actualArrival: "",
    },
    {
      id: "mat-3",
      name: "Toe Puff",
      supplier: "FootForm Ltd.",
      poNumber: "PO-2026-003",
      requiredQty: 600,
      receivedQty: 260,
      unit: "pairs",
      status: "Delayed",
      expectedArrival: "2026-06-04",
      actualArrival: "",
    },
    {
      id: "mat-4",
      name: "Packaging Boxes",
      supplier: "PackRight",
      poNumber: "PO-2026-005",
      requiredQty: 2000,
      receivedQty: 2000,
      unit: "boxes",
      status: "Received",
      expectedArrival: "2026-06-01",
      actualArrival: "2026-06-01",
    },
  ],
  approvals: [
    {
      id: "app-1",
      type: "Sample Approval",
      poNumber: "PO-2026-001",
      buyer: "Aldo",
      status: "Approved",
      date: "2026-05-26",
      notes: "Buyer confirmed gold sample.",
    },
    {
      id: "app-2",
      type: "Material Approval",
      poNumber: "PO-2026-002",
      buyer: "Clarks",
      status: "Pending",
      date: "2026-06-06",
      notes: "Sole shade approval pending.",
    },
    {
      id: "app-3",
      type: "Customer Approval",
      poNumber: "PO-2026-003",
      buyer: "Geox",
      status: "Delayed",
      date: "2026-06-04",
      notes: "Waiting for revised photo approval.",
    },
  ],
  productionLines: [
    {
      id: "line-1",
      name: "Cutting Line 01",
      department: "Cutting",
      currentStyle: "ALD-3421",
      currentOrder: "PO-2026-001",
      dailyTarget: 650,
      dailyActual: 628,
      capacity: 700,
      status: "Running",
    },
    {
      id: "line-2",
      name: "Upper Line 01",
      department: "Upper",
      currentStyle: "ALD-3421",
      currentOrder: "PO-2026-001",
      dailyTarget: 300,
      dailyActual: 286,
      capacity: 300,
      status: "Running",
    },
    {
      id: "line-3",
      name: "Upper Line 02",
      department: "Upper",
      currentStyle: "CLK-9912",
      currentOrder: "PO-2026-002",
      dailyTarget: 300,
      dailyActual: 190,
      capacity: 300,
      status: "Delayed",
    },
    {
      id: "line-4",
      name: "Bottom Line 01",
      department: "Bottom",
      currentStyle: "ALD-3421",
      currentOrder: "PO-2026-001",
      dailyTarget: 600,
      dailyActual: 590,
      capacity: 600,
      status: "Running",
    },
    {
      id: "line-5",
      name: "Packing Line 01",
      department: "Packing",
      currentStyle: "BAT-1102",
      currentOrder: "PO-2026-005",
      dailyTarget: 600,
      dailyActual: 540,
      capacity: 600,
      status: "Running",
    },
  ],
  dailyUpdates: [
    {
      id: "upd-cutting",
      date: "2026-06-06",
      stage: "Cutting",
      lineId: "line-1",
      lineName: "Cutting Line 01",
      department: "Cutting",
      poNumber: "PO-2026-004",
      customerName: "Ecco",
      styleCode: "ECC-7723",
      currentStyle: "ECC-7723",
      targetQuantity: 1000,
      actualQuantity: 920,
      notes: "Clicking delayed by leather shade sorting.",
    },
    {
      id: "upd-1",
      date: "2026-06-06",
      stage: "Upper",
      lineId: "line-2",
      lineName: "Upper Line 01",
      department: "Upper",
      poNumber: "PO-2026-001",
      customerName: "Aldo",
      styleCode: "ALD-3421",
      currentStyle: "ALD-3421",
      targetQuantity: 300,
      actualQuantity: 286,
      notes: "Minor upper rework on 14 pairs.",
    },
    {
      id: "upd-closing",
      date: "2026-06-06",
      stage: "Upper",
      lineId: "line-3",
      lineName: "Upper Line 02",
      department: "Upper",
      poNumber: "PO-2026-002",
      customerName: "Clarks",
      styleCode: "CLK-9912",
      currentStyle: "CLK-9912",
      targetQuantity: 900,
      actualQuantity: 740,
      notes: "Upper output reduced by eyelet setting queue.",
    },
    {
      id: "upd-2",
      date: "2026-06-06",
      stage: "Bottom",
      lineId: "line-4",
      lineName: "Bottom Line 01",
      department: "Bottom",
      poNumber: "PO-2026-001",
      customerName: "Aldo",
      styleCode: "ALD-3421",
      currentStyle: "ALD-3421",
      targetQuantity: 600,
      actualQuantity: 590,
      notes: "On target.",
    },
    {
      id: "upd-finishing",
      date: "2026-06-06",
      stage: "Bottom",
      lineId: "",
      lineName: "Bottom finishing",
      poNumber: "PO-2026-006",
      customerName: "Hush Puppies",
      styleCode: "HP-4410",
      currentStyle: "HP-4410",
      targetQuantity: 500,
      actualQuantity: 455,
      notes: "Final polish and lace inspection running slightly under target.",
    },
    {
      id: "upd-3",
      date: "2026-06-06",
      stage: "Packing",
      lineId: "line-5",
      lineName: "Packing Line 01",
      department: "Packing",
      poNumber: "PO-2026-005",
      customerName: "Bata",
      styleCode: "BATA-221",
      currentStyle: "BATA-221",
      targetQuantity: 600,
      actualQuantity: 540,
      notes: "Carton shortage in afternoon shift.",
    },
  ],
  dailyLogs: [
    {
      id: "log-material-shortage",
      title: "Outsole material delayed by vendor",
      note: "Toe Puff shipment from FootForm Ltd. is delayed. Purchasing is following up and production should prioritize available Aldo uppers first.",
      date: "2026-06-06",
      authorId: "demo-planning",
      authorName: "Planning Lead",
      departmentStage: "Materials",
      purchaseOrderId: "po-2",
      poNumber: "PO-2026-002",
      customerName: "Clarks",
      priority: "High",
      status: "Open",
      createdAt: "2026-06-06T08:35:00.000Z",
      updatedAt: "2026-06-06T08:35:00.000Z",
    },
    {
      id: "log-machine-maintenance",
      title: "Machine 3 stopped for maintenance",
      note: "Upper Line 02 machine 3 stopped during the afternoon shift. Maintenance expects restart before the next shift.",
      date: "2026-06-06",
      authorId: "demo-production",
      authorName: "Production Supervisor",
      departmentStage: "Upper",
      purchaseOrderId: "",
      poNumber: "",
      priority: "Medium",
      status: "Open",
      createdAt: "2026-06-06T13:20:00.000Z",
      updatedAt: "2026-06-06T13:20:00.000Z",
    },
    {
      id: "log-stage-move",
      title: "PO-2026-001 moved to Bottom",
      note: "Aldo PO-2026-001 completed upper checks and moved to Bottom. Bottom Line 01 is running close to plan.",
      date: "2026-06-06",
      authorId: "demo-production",
      authorName: "Production Supervisor",
      departmentStage: "Bottom",
      purchaseOrderId: "po-1",
      poNumber: "PO-2026-001",
      customerName: "Aldo",
      priority: "Low",
      status: "Resolved",
      createdAt: "2026-06-06T10:10:00.000Z",
      updatedAt: "2026-06-06T10:10:00.000Z",
    },
    {
      id: "log-customer-change",
      title: "Customer requested packaging change",
      note: "Bata asked to switch to the updated carton label artwork for PO-2026-005. Packing team should confirm label stock before final packing.",
      date: "2026-06-06",
      authorId: "demo-sales",
      authorName: "Sales Coordinator",
      departmentStage: "Packing",
      purchaseOrderId: "po-5",
      poNumber: "PO-2026-005",
      customerName: "Bata",
      priority: "Medium",
      status: "Open",
      createdAt: "2026-06-06T11:45:00.000Z",
      updatedAt: "2026-06-06T11:45:00.000Z",
    },
  ],
  productionTimeline: [...baseProductionTimeline, ...scalableProductionTimeline],
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

export function getDemoUsers() {
  demoUsersCache ??= readJson<DemoUser[]>(USER_KEY, demoUsers);
  return demoUsersCache;
}

export function saveDemoUser(profile: Partial<Profile> & { userId: string }) {
  const users = getDemoUsers();
  const next = users.map((user) =>
    user.userId === profile.userId
      ? {
          ...user,
          fullName: profile.fullName ?? user.fullName,
          department: profile.department ?? user.department,
          role: profile.role === undefined ? user.role : (profile.role as Role | null),
          active: profile.active ?? user.active,
        }
      : user,
  );
  demoUsersCache = next;
  writeJson(USER_KEY, next);
  return toProfile(next.find((user) => user.userId === profile.userId) ?? users[0]);
}

export function createDemoUser(profile: {
  email: string;
  fullName?: string | null;
  department?: string | null;
  role?: Role | null;
  active?: boolean;
}) {
  const users = getDemoUsers();
  if (users.some((user) => user.email.toLowerCase() === profile.email.trim().toLowerCase())) {
    throw new Error("A user with this email already exists.");
  }

  const nextUser: DemoUser = {
    userId: makeId("demo-user"),
    email: profile.email.trim(),
    // DEMO ONLY: newly created demo users use the shared meeting-demo password.
    password: "password123",
    fullName: profile.fullName || profile.email.trim(),
    department: profile.department ?? null,
    role: profile.role ?? "Sales",
    active: profile.active ?? false,
  };
  const next = [nextUser, ...users];
  demoUsersCache = next;
  writeJson(USER_KEY, next);
  return toProfile(nextUser);
}

export function resetDemoData() {
  demoDataCache = seedData;
  demoUsersCache = demoUsers;
  writeJson(DATA_KEY, seedData);
  writeJson(USER_KEY, demoUsers);
}

export function ensureDemoData() {
  if (typeof window === "undefined") return;
  if (!window.localStorage.getItem(DATA_KEY)) {
    demoDataCache = seedData;
    writeJson(DATA_KEY, seedData);
  }
  if (!window.localStorage.getItem(USER_KEY)) {
    demoUsersCache = demoUsers;
    writeJson(USER_KEY, demoUsers);
  }
}

function inferOrderStage(order: Partial<PurchaseOrder>): PurchaseOrder["currentStage"] {
  const currentStage = String(order.currentStage ?? "");
  if (currentStage === "Stitching" || currentStage === "Closing") return "Upper";
  if (currentStage === "Lasting" || currentStage === "Finishing") return "Bottom";
  if (order.currentStage) return order.currentStage;
  if (order.status === "Shipped" || order.status === "Ready To Ship") return "Completed";
  if (order.status === "Packing") return "Packing";
  if (order.status === "Production Running") return "Bottom";
  if (order.status === "Delayed") return "Upper";
  return "Cutting";
}

function stageFromDepartment(department: ProductionDepartment | undefined): ProductionStage {
  if (department === "Upper") return "Upper";
  if (department === "Bottom") return "Bottom";
  if (department === "Packing") return "Packing";
  return "Cutting";
}

function mergeById<T extends { id: string }>(current: T[] | undefined, additions: T[]) {
  const existing = current ?? [];
  const ids = new Set(existing.map((item) => item.id));
  return [...existing, ...additions.filter((item) => !ids.has(item.id))];
}

function withScalableDemoData(data: DemoData): DemoData {
  return {
    ...data,
    purchaseOrders: mergeById(data.purchaseOrders, scalableDemoData.purchaseOrders),
    purchaseOrderSizes: mergeById(data.purchaseOrderSizes, scalableDemoData.purchaseOrderSizes),
    bomMaterials: mergeById(data.bomMaterials, scalableDemoData.bomMaterials),
    materialRequirements: mergeById(
      data.materialRequirements,
      scalableDemoData.materialRequirements,
    ),
    materialPurchaseOrders: mergeById(
      data.materialPurchaseOrders,
      scalableDemoData.materialPurchaseOrders,
    ),
    materialPoItems: mergeById(data.materialPoItems, scalableDemoData.materialPoItems),
    productionTimeline: mergeById(
      mergeById(data.productionTimeline, baseProductionTimeline),
      scalableProductionTimeline,
    ),
  };
}

export function getDemoData() {
  if (demoDataCache) return demoDataCache;

  const data = withScalableDemoData(readJson<DemoData>(DATA_KEY, seedData));
  const bomDefaults = new Map(seedData.bomMaterials.map((item) => [item.id, item]));
  const nextBomMaterials = (data.bomMaterials ?? seedData.bomMaterials).map((item) => {
    const fallback = bomDefaults.get(item.id);
    return {
      ...item,
      defaultVendorId: item.defaultVendorId ?? fallback?.defaultVendorId ?? "",
      defaultVendorName: item.defaultVendorName ?? fallback?.defaultVendorName ?? "",
    };
  });
  const productionLines = data.productionLines ?? seedData.productionLines;
  const purchaseOrders = (data.purchaseOrders ?? seedData.purchaseOrders).map((order) => ({
    ...order,
    currentStage: inferOrderStage(order),
  }));
  const dailyUpdates = (data.dailyUpdates ?? seedData.dailyUpdates).map((update) => {
    const line = productionLines.find((item) => item.id === update.lineId);
    const currentStage = String(update.stage ?? "");
    const mappedStage =
      currentStage === "Stitching" || currentStage === "Closing"
        ? "Upper"
        : currentStage === "Lasting" || currentStage === "Finishing"
          ? "Bottom"
          : update.stage;
    return {
      ...update,
      stage: mappedStage ?? stageFromDepartment(update.department ?? line?.department),
      lineName: update.lineName || line?.name || mappedStage || "",
    };
  });

  demoDataCache = {
    ...seedData,
    ...data,
    customers: data.customers ?? seedData.customers,
    purchaseOrders,
    purchaseOrderSizes: data.purchaseOrderSizes ?? seedData.purchaseOrderSizes,
    materials: data.materials ?? seedData.materials,
    bomMaterials: nextBomMaterials,
    vendors: data.vendors ?? seedData.vendors,
    materialRequirements: data.materialRequirements ?? seedData.materialRequirements,
    materialPurchaseOrders: data.materialPurchaseOrders ?? seedData.materialPurchaseOrders,
    materialPoItems: data.materialPoItems ?? seedData.materialPoItems,
    materialPoEmailLogs: data.materialPoEmailLogs ?? seedData.materialPoEmailLogs,
    approvals: data.approvals ?? seedData.approvals,
    productionLines,
    dailyUpdates,
    dailyLogs: data.dailyLogs ?? seedData.dailyLogs,
    productionTimeline: data.productionTimeline ?? seedData.productionTimeline,
  };
  return demoDataCache;
}

export function saveDemoData(data: DemoData) {
  demoDataCache = data;
  writeJson(DATA_KEY, data);
}

export function clearDemoData() {
  demoDataCache = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DATA_KEY);
  }
}

export function getDemoSession() {
  return readJson<{ userId: string } | null>(SESSION_KEY, null);
}

export function setDemoSession(userId: string | null) {
  if (typeof window === "undefined") return;
  if (userId) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

export function toProfile(user: DemoUser): Profile {
  return {
    userId: user.userId,
    email: user.email,
    fullName: user.fullName,
    department: user.department,
    role: user.role,
    active: user.active,
  };
}

export function authenticateDemoUser(email: string, password: string) {
  const user = getDemoUsers().find(
    (item) => item.email.toLowerCase() === email.trim().toLowerCase() && item.password === password,
  );
  if (!user) return null;
  setDemoSession(user.userId);
  return toProfile(user);
}

export function getCurrentDemoProfile() {
  const session = getDemoSession();
  if (!session) return null;
  const user = getDemoUsers().find((item) => item.userId === session.userId);
  return user ? toProfile(user) : null;
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function attachOrderSizes(
  orders: PurchaseOrder[],
  sizes: PurchaseOrderSize[],
): PurchaseOrder[] {
  const sizesByOrder = new Map<string, PurchaseOrderSize[]>();
  for (const size of sizes) {
    const orderSizes = sizesByOrder.get(size.purchaseOrderId) ?? [];
    orderSizes.push(size);
    sizesByOrder.set(size.purchaseOrderId, orderSizes);
  }

  return orders.map((order) => {
    const orderSizes = sizesByOrder.get(order.id) ?? [];
    const sizeTotal = orderSizes.reduce((sum, size) => sum + Number(size.quantity || 0), 0);
    return {
      ...order,
      sizes: orderSizes,
      sizeTotal,
      sizeTotalWarning:
        orderSizes.length > 0 && sizeTotal !== order.quantity
          ? `Size total ${sizeTotal} does not match PO quantity ${order.quantity}.`
          : undefined,
    };
  });
}

export function getDashboardMetrics(data = getDemoData()): DashboardMetrics {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const riskDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const orders = attachOrderSizes(data.purchaseOrders, data.purchaseOrderSizes);
  const productionDate = data.dailyUpdates.some((item) => item.date === today)
    ? today
    : "2026-06-06";
  const updatesForProduction = data.dailyUpdates.filter((item) => item.date === productionDate);
  const productionBreakdown: ProductionStageSummary[] = productionStageOrder.map((stage) => {
    const stageUpdates = updatesForProduction.filter((update) => update.stage === stage);
    const departmentLines = data.productionLines.filter((line) => line.department === stage);
    const updatedLineIds = new Set(stageUpdates.map((update) => update.lineId).filter(Boolean));
    const fallbackLines = departmentLines.filter((line) => !updatedLineIds.has(line.id));
    const target =
      stageUpdates.reduce((sum, update) => sum + update.targetQuantity, 0) +
      fallbackLines.reduce((sum, line) => sum + line.dailyTarget, 0);
    const actual =
      stageUpdates.reduce((sum, update) => sum + update.actualQuantity, 0) +
      fallbackLines.reduce((sum, line) => sum + line.dailyActual, 0);
    return {
      stage,
      label: productionStageLabels[stage],
      target,
      actual,
      remaining: Math.max(target - actual, 0),
      activeLines: departmentLines.filter((line) => line.status !== "Stopped").length,
      activePurchaseOrders: departmentLines.filter((line) => line.currentOrder).length,
      difference: actual - target,
      achievementPercent: achievementPercent(actual, target),
      delayedOrUnderTarget:
        orders.some((order) => order.currentStage === stage && order.status === "Delayed") ||
        actual < target,
    };
  });
  const todayProductionTarget = productionBreakdown.reduce((sum, item) => sum + item.target, 0);
  const todayProductionActual = productionBreakdown.reduce((sum, item) => sum + item.actual, 0);
  const logDate = data.dailyLogs.some((item) => item.date === today) ? today : "2026-06-06";
  const dailyLogs = [...data.dailyLogs].sort((a, b) =>
    (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date),
  );

  const yesterdayProduction = data.dailyUpdates
    .filter((item) => item.date === yesterday || item.date === "2026-06-06")
    .reduce((sum, item) => sum + item.actualQuantity, 0);

  return {
    activeOrders: orders.filter((item) => item.status !== "Shipped").length,
    delayedOrders: orders.filter((item) => item.status === "Delayed").length,
    pendingApprovals: orders.filter((item) => !item.approved && item.status !== "Shipped").length,
    yesterdayProduction,
    todayProductionTarget,
    todayProductionActual,
    productionAchievementPercent: achievementPercent(todayProductionActual, todayProductionTarget),
    productionBreakdown,
    delayedProductionDepartments: productionBreakdown
      .filter((item) => item.delayedOrUnderTarget)
      .map((item) => item.label),
    ordersAtRisk: orders.filter(
      (item) =>
        item.status === "Delayed" ||
        calculateShipmentRisk(item) !== "Low" ||
        (item.deliveryDate <= riskDate && !["Ready To Ship", "Shipped"].includes(item.status)),
    ).length,
    pendingShipments: orders.filter((item) => item.status === "Ready To Ship").length,
    materialPending: data.materialRequirements.filter((item) => item.balanceQuantity > 0).length,
    draftMaterialPos: data.materialPurchaseOrders.filter((item) => item.status === "Draft").length,
    openDailyLogs: data.dailyLogs.filter((item) => item.status === "Open").length,
    highPriorityDailyLogs: data.dailyLogs.filter(
      (item) => item.status === "Open" && item.priority === "High",
    ).length,
    todaysDailyLogs: data.dailyLogs.filter((item) => item.date === logDate).length,
    recentDailyLogs: dailyLogs.slice(0, 5),
    recentAlerts: [
      {
        id: "alert-1",
        message: "PO-2026-003 marked as Delayed",
        time: `${today}T09:15:00.000Z`,
        severity: "danger",
      },
      {
        id: "alert-2",
        message: "Toe Puff shipment delayed from FootForm Ltd.",
        time: `${today}T08:40:00.000Z`,
        severity: "warning",
      },
      {
        id: "alert-3",
        message: "PO-2026-005 moved to Packing",
        time: `${today}T07:30:00.000Z`,
        severity: "info",
      },
    ],
    recentPurchaseOrders: [...orders]
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
      .slice(0, 5),
  };
}

export function getReportRows(type: ReportType, data = getDemoData()) {
  if (type === "daily-production" || type === "weekly-production") {
    return data.dailyUpdates.map((item) => ({
      Date: item.date,
      Stage: item.stage,
      Line: item.lineName,
      "PO Number": item.poNumber,
      Customer: item.customerName ?? "",
      Style: item.styleCode || item.currentStyle || "",
      Target: item.targetQuantity,
      Actual: item.actualQuantity,
      Achievement: item.targetQuantity
        ? `${Math.round((item.actualQuantity / item.targetQuantity) * 100)}%`
        : "0%",
      Notes: item.notes,
    }));
  }

  if (type === "material-status") {
    return data.materials.map((item) => ({
      Material: item.name,
      Supplier: item.supplier,
      "PO Number": item.poNumber,
      Required: `${item.requiredQty} ${item.unit}`,
      Received: `${item.receivedQty} ${item.unit}`,
      Balance: `${Math.max(item.requiredQty - item.receivedQty, 0)} ${item.unit}`,
      Status: item.status,
      "Expected Arrival": item.expectedArrival,
      "Actual Arrival": item.actualArrival || "-",
    }));
  }

  return attachOrderSizes(data.purchaseOrders, data.purchaseOrderSizes)
    .filter(
      (item) =>
        type !== "shipment-status" || ["Packing", "Ready To Ship", "Shipped"].includes(item.status),
    )
    .map((item) => ({
      "PO Number": item.poNumber,
      Customer: item.customerName || item.buyer,
      Brand: item.brand,
      Article: item.article,
      "Style Code": item.styleCode,
      "Style Name": item.styleName,
      Color: item.color,
      Quantity: item.quantity,
      "Size Total": item.sizeTotal ?? 0,
      "Delivery Date": item.deliveryDate,
      Status: item.status,
      Notes: item.notes,
    }));
}
