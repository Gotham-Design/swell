import type { Industry } from "@/lib/validation/business";

type Starter = { name: string; type: "income" | "expense"; description: string };

/** Categories every business gets from the standard chart (private.seed_standard_chart). */
export const STANDARD_INCOME = ["Sales", "Service Revenue", "Interest Income", "Other Income"];
export const STANDARD_EXPENSE = [
  "Advertising & Marketing", "Bank Fees", "Contractors", "Insurance", "Meals", "Office Supplies", "Professional Fees",
  "Rent", "Repairs & Maintenance", "Software & Subscriptions", "Travel", "Utilities", "Payroll", "Payroll Taxes",
  "Taxes & Licenses", "Vehicle", "Shipping & Postage", "Education", "Other Expense",
];

/**
 * Per industry: the standard categories worth showing first, plus a few extra custom ones
 * created with the business. Extras are plain custom categories: rename or archive any time.
 */
export const STARTERS: Record<Industry, { income: string[]; expense: string[]; extras: Starter[] }> = {
  food_beverage: {
    income: ["Sales", "Catering"], expense: ["Ingredients", "Packaging", "Payroll", "Rent", "Utilities", "Bank Fees"],
    extras: [
      { name: "Catering", type: "income", description: "Catering orders and private events." },
      { name: "Ingredients", type: "expense", description: "Food, drink and other ingredients bought to make what you sell." },
      { name: "Packaging", type: "expense", description: "Boxes, cups, bags, labels and other packaging." },
    ],
  },
  retail: {
    income: ["Sales", "Refunds & Returns"], expense: ["Inventory Purchases", "Shipping & Postage", "Rent", "Payroll", "Bank Fees"],
    extras: [{ name: "Inventory Purchases", type: "expense", description: "Products bought to resell." }],
  },
  professional_services: {
    income: ["Service Revenue", "Reimbursed Expenses"], expense: ["Software & Subscriptions", "Professional Fees", "Contractors", "Travel", "Meals", "Insurance"],
    extras: [{ name: "Reimbursed Expenses", type: "income", description: "Client reimbursements for costs you paid on their behalf." }],
  },
  construction_trades: {
    income: ["Service Revenue", "Materials Resale"], expense: ["Materials & Supplies", "Equipment Rental", "Fuel", "Subcontractors", "Vehicle", "Insurance"],
    extras: [
      { name: "Materials Resale", type: "income", description: "Materials billed to customers on a job." },
      { name: "Materials & Supplies", type: "expense", description: "Lumber, plants, parts and other materials used on jobs." },
      { name: "Equipment Rental", type: "expense", description: "Rented tools, machines and equipment." },
      { name: "Fuel", type: "expense", description: "Gas and diesel for vehicles and equipment." },
      { name: "Subcontractors", type: "expense", description: "Other trades hired to do part of a job." },
    ],
  },
  health_wellness: {
    income: ["Service Revenue", "Product Sales"], expense: ["Clinical Supplies", "Rent", "Software & Subscriptions", "Insurance", "Education"],
    extras: [
      { name: "Product Sales", type: "income", description: "Retail products sold to clients." },
      { name: "Clinical Supplies", type: "expense", description: "Supplies used with clients." },
    ],
  },
  creative_media: {
    income: ["Service Revenue", "Licensing & Royalties"], expense: ["Equipment", "Software & Subscriptions", "Contractors", "Travel", "Advertising & Marketing"],
    extras: [
      { name: "Licensing & Royalties", type: "income", description: "Licensing fees and royalties for your work." },
      { name: "Equipment", type: "expense", description: "Cameras, computers and gear under your capitalization threshold." },
    ],
  },
  real_estate: {
    income: ["Rental Income", "Commissions"], expense: ["Property Management", "Repairs & Maintenance", "Insurance", "Utilities", "Taxes & Licenses"],
    extras: [
      { name: "Rental Income", type: "income", description: "Rent received from tenants." },
      { name: "Commissions", type: "income", description: "Sales and leasing commissions." },
      { name: "Property Management", type: "expense", description: "Management company fees." },
    ],
  },
  transportation: {
    income: ["Service Revenue"], expense: ["Fuel", "Vehicle", "Repairs & Maintenance", "Insurance", "Tolls & Parking"],
    extras: [
      { name: "Fuel", type: "expense", description: "Gas and diesel." },
      { name: "Tolls & Parking", type: "expense", description: "Road tolls and parking." },
    ],
  },
  nonprofit: {
    income: ["Donations", "Grants", "Program Revenue"], expense: ["Program Expenses", "Payroll", "Rent", "Advertising & Marketing"],
    extras: [
      { name: "Donations", type: "income", description: "Gifts from individuals and organizations." },
      { name: "Grants", type: "income", description: "Grant funding." },
      { name: "Program Revenue", type: "income", description: "Fees for programs and services." },
      { name: "Program Expenses", type: "expense", description: "Costs of running programs." },
    ],
  },
  other: { income: ["Sales", "Service Revenue"], expense: ["Bank Fees", "Software & Subscriptions", "Contractors", "Insurance", "Utilities"], extras: [] },
};
