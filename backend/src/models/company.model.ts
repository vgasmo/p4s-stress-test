import type { Queryable } from '../config/database.js';
import type { Company, SectorProfile } from './domain.js';

const COLUMNS =
  'id, name, nif, cae, annual_revenue, export_percentage, sector_profile, created_at, updated_at';

interface CompanyRow {
  id: string;
  name: string;
  nif: string;
  cae: string;
  annual_revenue: number;
  export_percentage: number;
  sector_profile: SectorProfile;
  created_at: Date;
  updated_at: Date;
}

const toCompany = (row: CompanyRow): Company => ({
  id: row.id,
  name: row.name,
  nif: row.nif,
  cae: row.cae,
  annualRevenue: row.annual_revenue,
  exportPercentage: row.export_percentage,
  sectorProfile: row.sector_profile,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export interface NewCompany {
  name: string;
  nif: string;
  /** Vazio quando a empresa foi criada à pressa em reunião (só NIF + nome). */
  cae: string;
  sectorProfile: SectorProfile;
  annualRevenue: number;
  exportPercentage: number;
}

export const companyModel = {
  async findById(db: Queryable, id: string): Promise<Company | null> {
    const { rows } = await db.query<CompanyRow>(`SELECT ${COLUMNS} FROM companies WHERE id = $1`, [id]);
    return rows[0] ? toCompany(rows[0]) : null;
  },

  async findByNif(db: Queryable, nif: string): Promise<Company | null> {
    const { rows } = await db.query<CompanyRow>(`SELECT ${COLUMNS} FROM companies WHERE nif = $1`, [nif]);
    return rows[0] ? toCompany(rows[0]) : null;
  },

  async list(db: Queryable): Promise<Company[]> {
    const { rows } = await db.query<CompanyRow>(`SELECT ${COLUMNS} FROM companies ORDER BY name`);
    return rows.map(toCompany);
  },

  async insert(db: Queryable, company: NewCompany): Promise<Company> {
    const { rows } = await db.query<CompanyRow>(
      `INSERT INTO companies (name, nif, cae, sector_profile, annual_revenue, export_percentage)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        company.name,
        company.nif,
        company.cae,
        company.sectorProfile,
        company.annualRevenue,
        company.exportPercentage,
      ],
    );
    return toCompany(rows[0] as CompanyRow);
  },

  /**
   * Cria a empresa se o NIF ainda não existir. Com pedidos em simultâneo para o mesmo NIF,
   * só um insere e os outros recebem null (e leem a que ficou).
   */
  async insertIfAbsent(db: Queryable, company: NewCompany): Promise<Company | null> {
    const { rows } = await db.query<CompanyRow>(
      `INSERT INTO companies (name, nif, cae, sector_profile, annual_revenue, export_percentage)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (nif) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        company.name,
        company.nif,
        company.cae,
        company.sectorProfile,
        company.annualRevenue,
        company.exportPercentage,
      ],
    );
    return rows[0] ? toCompany(rows[0]) : null;
  },

  async update(db: Queryable, id: string, patch: Partial<NewCompany>): Promise<Company | null> {
    const { rows } = await db.query<CompanyRow>(
      `UPDATE companies
       SET name = COALESCE($2, name),
           nif = COALESCE($3, nif),
           cae = COALESCE($4, cae),
           sector_profile = COALESCE($5, sector_profile),
           annual_revenue = COALESCE($6, annual_revenue),
           export_percentage = COALESCE($7, export_percentage),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id,
        patch.name ?? null,
        patch.nif ?? null,
        patch.cae ?? null,
        patch.sectorProfile ?? null,
        patch.annualRevenue ?? null,
        patch.exportPercentage ?? null,
      ],
    );
    return rows[0] ? toCompany(rows[0]) : null;
  },
};
