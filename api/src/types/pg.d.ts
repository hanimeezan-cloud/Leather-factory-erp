declare module "pg" {
  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
    rows: T[];
    rowCount: number | null;
  }

  export interface PoolClient {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<T>>;
    release(): void;
  }

  export class Pool {
    constructor(config: { connectionString: string });
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
