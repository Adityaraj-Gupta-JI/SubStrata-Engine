// src/lib/browserDb.ts

export interface EAVRow {
  entity_id: string;
  entity_name: string;
  attribute: string;
  value: string;
}

export const getTenantData = (tenantId: string): EAVRow[] => {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(`substrata_${tenantId}`);
  return data ? JSON.parse(data) : [];
};

export const setTenantData = (tenantId: string, rows: EAVRow[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`substrata_${tenantId}`, JSON.stringify(rows));
};