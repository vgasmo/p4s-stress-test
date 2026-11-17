import { pool } from '../config/database.js';
import type { AssignableUser } from '../models/api.types.js';
import { companyModel } from '../models/company.model.js';
import { isStaffRole, type AuthUser, type Company, type TenantContext } from '../models/domain.js';
import type { CreateCompanyInput, UpdateCompanyInput } from '../models/schemas.js';
import { userModel } from '../models/user.model.js';
import { conflict, notFound } from '../utils/errors.js';

export const companyService = {
  /** Equipa P4S: carteira de empresas clientes. */
  async list(): Promise<Company[]> {
    return companyModel.list(pool);
  },

  async get(auth: AuthUser, id: string): Promise<Company> {
    // Um utilizador da empresa só vê a sua. Outra empresa responde 404, sem revelar que existe.
    if (!isStaffRole(auth.role) && auth.companyId !== id) throw notFound('Empresa não encontrada.');
    const company = await companyModel.findById(pool, id);
    if (!company) throw notFound('Empresa não encontrada.');
    return company;
  },

  async create(input: CreateCompanyInput): Promise<Company> {
    if (await companyModel.findByNif(pool, input.nif)) {
      throw conflict(`Já existe uma empresa com o NIF ${input.nif}.`);
    }
    return companyModel.insert(pool, input);
  },

  /** Corrige os dados de uma empresa (nome mal escrito em reunião, CAE em falta, setor, faturação). */
  async update(id: string, input: UpdateCompanyInput): Promise<Company> {
    const current = await companyModel.findById(pool, id);
    if (!current) throw notFound('Empresa não encontrada.');
    if (input.nif !== undefined && input.nif !== current.nif && (await companyModel.findByNif(pool, input.nif))) {
      throw conflict(`Já existe uma empresa com o NIF ${input.nif}.`);
    }
    const updated = await companyModel.update(pool, id, input);
    if (!updated) throw notFound('Empresa não encontrada.');
    return updated;
  },

  /**
   * Possíveis responsáveis por tarefas na empresa selecionada. Só nome e equipa: esta lista
   * também chega aos clientes, que não precisam dos emails de login da equipa P4S.
   */
  async listAssignableUsers(ctx: TenantContext): Promise<AssignableUser[]> {
    const users = await userModel.listAssignable(pool, ctx.companyId);
    return users.map(({ id, fullName, role }) => ({ id, fullName, team: isStaffRole(role) ? 'p4s' : 'company' }));
  },
};
