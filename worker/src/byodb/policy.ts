import { createHash } from "node:crypto";
import { badRequest, unavailable } from "../errors";
export interface Destination {
    id: string;
    hostname: string;
    address: string;
    port: number;
    databases: string[];
    roles: string[];
    schemas: string[];
}
export function publicIPv4(value: string) {
    if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))
        return false;
    const [a, b, c, d] = value.split('.').map(Number);
    if ([a, b, c, d].some(v => v > 255))
        return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
export function destinations(value: string | undefined): Destination[] {
    try {
        const list: unknown = JSON.parse(value ?? '');
        if (!Array.isArray(list) || !list.length || list.length > 32)
            throw unavailable();
        const ids = new Set<string>();
        return list.map(row => {
            if (!row || typeof row !== "object" || Object.keys(row).some(k => !["id", "hostname", "address", "port", "databases", "roles", "schemas"].includes(k)))
                throw unavailable();
            const d = row as Destination;
            if (!/^[a-z0-9-]{1,60}$/.test(d.id) || ids.has(d.id) || typeof d.hostname !== "string" || d.hostname.length > 253 || !d.hostname.includes('.') || !d.hostname.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) || !publicIPv4(d.address) || d.port !== 5432)
                throw unavailable();
            for (const field of [d.databases, d.roles, d.schemas])
                if (!Array.isArray(field) || !field.length || field.length > 32 || field.some(v => typeof v !== "string" || !/^[_a-zA-Z][_a-zA-Z0-9]{0,62}$/.test(v) || /^(pg_|information_schema$)/i.test(v)))
                    throw unavailable();
            ids.add(d.id);
            return Object.freeze({ ...d });
        });
    }
    catch {
        throw unavailable();
    }
}
export function selectedDestination(config: string | undefined, id: string, database: string, role: string, schema: string) {
    const d = destinations(config).find(item => item.id === id);
    if (!d || !d.databases.includes(database) || !d.roles.includes(role) || !d.schemas.includes(schema))
        throw badRequest("Destination, database, role or schema is not approved by the administrator.");
    return d;
}
export function destinationDigest(d: Destination) { return createHash('sha256').update(JSON.stringify([d.id, d.hostname, d.address, d.port, [...d.databases].sort(), [...d.roles].sort(), [...d.schemas].sort()])).digest('hex'); }
