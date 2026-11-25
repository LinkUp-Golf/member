// Hidden categories for free-text Curated Introductions. Members never see these.
// `legacy` is the current survey industry a sector rolls up to, so rules such as
// "Capital Provider" keep working. null marks a sector the current list can't express.

export const SECTORS = {
  legal: { label: 'Legal', legacy: 'Professional Services (Legal)', niches: ['corporate', 'litigation', 'real_estate', 'estate_planning', 'intellectual_property', 'employment', 'tax', 'immigration', 'family', 'personal_injury'] },
  accounting: { label: 'Accounting', legacy: 'Professional Services (Accounting)', niches: ['cpa_firm', 'tax', 'audit', 'bookkeeping', 'fractional_cfo', 'forensic'] },
  consulting: { label: 'Consulting', legacy: 'Professional Services (Consulting)', niches: ['strategy', 'management', 'operations', 'technology', 'exit_planning', 'executive_coaching'] },
  capital: { label: 'Capital providers', legacy: 'Capital Provider', niches: ['venture_capital', 'private_equity', 'family_office', 'angel', 'private_credit', 'hard_money', 'real_estate_investor', 'search_fund'] },
  insurance: { label: 'Insurance', legacy: 'Insurance', niches: ['commercial', 'life', 'health_benefits', 'property_casualty', 'personal_lines', 'captive'] },
  business_software: { label: 'Business software', legacy: 'Business Software', niches: ['saas', 'vertical_saas', 'crm_sales', 'finance_erp', 'hr_tech', 'ai_applications'] },
  business_services: { label: 'Business services', legacy: 'Business Services', niches: ['marketing_agency', 'public_relations', 'printing_signage', 'facilities', 'security', 'logistics_services', 'outsourcing'] },
  hr: { label: 'HR and recruitment', legacy: 'HR & Recruitment', niches: ['executive_search', 'staffing', 'peo', 'hr_consulting', 'payroll'] },
  real_estate: { label: 'Real estate', legacy: 'Real Estate', niches: ['commercial_brokerage', 'residential_brokerage', 'multifamily', 'industrial', 'development', 'property_management', 'title_escrow', 'mortgage'] },
  healthcare: { label: 'Healthcare and life sciences', legacy: 'Healthcare / Life Sciences', niches: ['physician_practice', 'dental', 'hospital', 'biotech', 'pharma', 'medical_devices', 'behavioral', 'senior_care', 'veterinary', 'aesthetics_wellness'] },
  financial: { label: 'Financial services', legacy: 'Financial Services', niches: ['commercial_banking', 'retail_banking', 'wealth_management', 'investment_banking', 'sba_lending', 'equipment_finance', 'payments', 'fintech'] },
  technology: { label: 'Technology', legacy: 'Technology', niches: ['it_services', 'cybersecurity', 'cloud_infrastructure', 'hardware', 'telecom', 'data_ai', 'software_development'] },
  nonprofit: { label: 'Non-profit', legacy: 'Non-profit', niches: ['charity', 'foundation', 'youth', 'education', 'health', 'association'] },
  // Not expressible on today's list.
  construction: { label: 'Construction and trades', legacy: null, niches: ['general_contractor', 'hvac', 'plumbing', 'electrical', 'roofing', 'landscaping', 'home_services', 'architecture_engineering'] },
  manufacturing: { label: 'Manufacturing', legacy: null, niches: ['industrial', 'food_beverage', 'aerospace_defense', 'consumer_goods', 'distribution'] },
  consumer: { label: 'Retail and consumer', legacy: null, niches: ['retail', 'ecommerce', 'franchise', 'automotive', 'beauty', 'fitness'] },
  hospitality: { label: 'Hospitality', legacy: null, niches: ['hotels', 'restaurants', 'golf_clubs', 'events', 'travel'] },
  transport_energy: { label: 'Transport and energy', legacy: null, niches: ['trucking', 'freight', 'aviation', 'oil_gas', 'solar_renewables', 'utilities'] },
  media: { label: 'Media and entertainment', legacy: null, niches: ['film_tv', 'publishing', 'sports', 'music', 'creator'] },
  public_education: { label: 'Government and education', legacy: null, niches: ['government', 'military', 'k12', 'higher_education'] },
}

export const FUNCTIONS = ['general_management', 'finance', 'accounting', 'marketing', 'sales', 'business_development', 'operations', 'product', 'engineering', 'it', 'data', 'hr', 'legal', 'clinical', 'investing', 'advisory', 'lending', 'philanthropy']
export const SENIORITY = ['owner', 'partner', 'c_suite', 'vp', 'director', 'manager', 'individual']

export const NICHES = Object.entries(SECTORS).flatMap(([s, v]) => v.niches.map(n => `${s}.${n}`))
export const NICHE_SET = new Set(NICHES)
export const FUNCTION_SET = new Set(FUNCTIONS)
export const SENIORITY_SET = new Set(SENIORITY)
export const sectorOf = tag => tag.split('.')[0]
