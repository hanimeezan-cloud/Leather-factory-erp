import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { NewButton, RecordDialog } from "@/components/record-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, type Profile, type Role } from "@/lib/domain";
import { useCreateUser, useUpdateUser, useUsers } from "@/lib/data-hooks";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users - Footwear Production Hub" },
      { name: "description", content: "Owner user and role management." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { data: users = [], isLoading, error } = useUsers();
  const createUser = useCreateUser();
  const [search, setSearch] = useState("");
  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      [
        user.email,
        user.fullName ?? "",
        user.department ?? "",
        user.role ?? "",
        user.active ? "active" : "inactive",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [search, users]);
  const emptyUser = {
    email: "",
    fullName: "",
    department: "",
    role: "Sales" as Role,
    active: false,
  };
  const userFields = [
    { name: "email", label: "Email", required: true },
    { name: "fullName", label: "Full Name" },
    { name: "department", label: "Department" },
    { name: "role", label: "Role", type: "select" as const, options: ROLES },
    { name: "active", label: "Active", type: "checkbox" as const },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Activate accounts and assign roles."
        actions={
          <RecordDialog
            title="New User"
            fields={userFields}
            initial={emptyUser}
            onSubmit={async (values) => {
              await createUser.mutateAsync(values);
              toast.success("User created");
            }}
            trigger={<NewButton label="New User" />}
          />
        }
      />
      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}
      <div className="mb-4 max-w-md">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search users by email, role, department..."
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <UserRow key={user.userId} user={user} />
                ))}
                {!isLoading && !filteredUsers.length ? (
                  <tr className="border-t border-border">
                    <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                      {users.length ? "No users match your search." : "No users found."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({ user }: { user: Profile }) {
  const updateUser = useUpdateUser();
  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [department, setDepartment] = useState(user.department ?? "");
  const [role, setRole] = useState<Role | null>(user.role);
  const [active, setActive] = useState(user.active);

  useEffect(() => {
    setFullName(user.fullName ?? "");
    setDepartment(user.department ?? "");
    setRole(user.role);
    setActive(user.active);
  }, [user.active, user.department, user.fullName, user.role]);

  const save = async () => {
    try {
      await updateUser.mutateAsync({
        userId: user.userId,
        fullName,
        department,
        role,
        active,
      });
      toast.success("User updated");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-3 font-medium">{user.email}</td>
      <td className="px-4 py-3">
        <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
      </td>
      <td className="px-4 py-3">
        <Input value={department} onChange={(event) => setDepartment(event.target.value)} />
      </td>
      <td className="px-4 py-3">
        <Select
          value={role ?? "none"}
          onValueChange={(value) => setRole(value === "none" ? null : (value as Role))}
        >
          <SelectTrigger className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No role</SelectItem>
            {ROLES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" onClick={save} disabled={updateUser.isPending}>
          Save
        </Button>
      </td>
    </tr>
  );
}
