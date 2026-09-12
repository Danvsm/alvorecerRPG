export type Row = Record<string, any>;
export type Field = {
  key: string;
  label: string;
  type?: string;
  value?: any;
  options?: Row[];
  required?: boolean;
};
export type Form = {
  title: string;
  fields: Field[];
  submit: (d: Row) => Promise<void>;
};
