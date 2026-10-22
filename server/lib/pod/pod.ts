import { SKILLS } from './skills';
import type { AgentId } from './data';

/* The CSR Pod as the app shows it: who is in it, what each member runs on, and who is accountable. */

export interface PodMember {
  id: AgentId;
  kind: 'source' | 'agent' | 'gate';
  title: string;
  actsFor?: string;
  how?: { name: string; text: string };
  acts?: string[];
  calls?: string[];
  note?: string;
}

export const DEPARTMENTS = [
  {
    department: 'Medical Writing',
    signer: 'Dr. Hannah Reid',
    role: 'CSR Lead',
    scope: 'Introduction, objectives, plan, conclusions, synopsis and discussion: sections 2, 7 to 9, 11.5 and 13',
    sections: ['2', '7', '8', '9', '11.5', '13'],
  },
  {
    department: 'Biostatistics',
    signer: 'Tom Okoye',
    role: 'Lead Statistician',
    scope: 'Every figure bound to a certified TLF cell, and the tables in section 14: sections 10, 11.1, 11.2, 11.4.1 and 11.4.2',
    sections: ['10', '11.1', '11.2', '11.4.1', '11.4.2', '14'],
  },
  {
    department: 'Clinical Safety',
    signer: 'Dr. Leila Haddad',
    role: 'Safety Physician',
    scope: 'Safety evaluation and patient narratives: sections 12.1 to 12.3.4 and 12.7',
    sections: ['12.1', '12.2', '12.3', '12.3.4', '12.7'],
  },
  {
    department: 'Regulatory Affairs',
    signer: 'Dr. Amara Okafor',
    role: 'Regulatory Review',
    scope: 'Release of the assembled CSR for submission',
    sections: [],
  },
] as const;

export const RELEASE_DEPARTMENT = 'Regulatory Affairs';
export const PREREQUISITE_DEPARTMENTS = ['Medical Writing', 'Biostatistics', 'Clinical Safety'];

const skill = (name: keyof typeof SKILLS) => ({ name, text: SKILLS[name] });

export const MEMBERS: PodMember[] = [
  {
    id: 'context',
    kind: 'source',
    title: 'Certified context',
    note: 'Certified TLF tables in Unity Catalog, the protocol and SAP parsed by ai_parse_document and indexed in AI Search, and the section registry. The submitted report is locked away from the pod.',
    calls: ['Unity Catalog', 'AI Search'],
  },
  {
    id: 'planner',
    kind: 'agent',
    title: 'Document Planner',
    actsFor: 'Medical Writing',
    how: skill('csr-planning'),
    acts: ['read_registry', 'list_certified_tables', 'find_passages', 'save_plan'],
    calls: ['AI Search'],
  },
  {
    id: 'author',
    kind: 'agent',
    title: 'CSR Author Agent',
    actsFor: 'Medical Writing',
    how: skill('csr-authoring'),
    acts: ['get_section_brief', 'search_documents', 'save_csr_draft'],
    calls: ['AI Search'],
  },
  {
    id: 'narrative',
    kind: 'agent',
    title: 'Safety Narrative Agent',
    actsFor: 'Clinical Safety',
    how: skill('safety-narratives'),
    acts: ['get_patient_record', 'save_narrative'],
  },
  {
    id: 'qc',
    kind: 'agent',
    title: 'QC & Consistency Agent',
    actsFor: 'Biostatistics',
    how: skill('csr-qc'),
    acts: ['run_section_checks', 'judge_section', 'flag_for_person', 'tick_and_tie'],
    calls: ['Submitted report (scoring only)', 'GPT 5.5 judge'],
  },
  {
    id: 'assembler',
    kind: 'agent',
    title: 'CSR Assembler',
    actsFor: 'Regulatory Operations',
    how: skill('ich-e3-assembly'),
    acts: ['assemble_fixed_parts', 'run_document_checks', 'finalise_document'],
  },
  {
    id: 'signoff',
    kind: 'gate',
    title: 'Departmental sign-off',
    note: 'Nothing is released until the responsible people sign.',
    calls: ['Medical Writing', 'Biostatistics', 'Clinical Safety', 'Regulatory Affairs'],
  },
];

export const POD = {
  columns: [
    { title: 'Context', members: ['context'] },
    { title: 'Plan', edge: 'registry + catalogue', members: ['planner'] },
    { title: 'Draft & check', edge: 'plan', parallel: true, members: ['author', 'narrative', 'qc'] },
    { title: 'Assemble', edge: 'sections + findings', members: ['assembler'] },
    { title: 'Sign-off', edge: 'draft', members: ['signoff'] },
  ],
  members: MEMBERS,
  departments: DEPARTMENTS,
};
