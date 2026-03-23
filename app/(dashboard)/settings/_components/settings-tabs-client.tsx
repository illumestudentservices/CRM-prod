"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsersSettingsTab } from "./users-tab";
import { RegionsSettingsTab } from "./regions-tab";
import { SecurityTab } from "./security-tab";

interface SettingsTabsClientProps {
  nodeEnv: string;
}

export function SettingsTabsClient({ nodeEnv }: SettingsTabsClientProps) {
  return (
    <Tabs defaultValue="users">
      <TabsList>
        <TabsTrigger value="users">Users & Roles</TabsTrigger>
        <TabsTrigger value="regions">Regions</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="system">System Info</TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="mt-4">
        <UsersSettingsTab />
      </TabsContent>
      <TabsContent value="regions" className="mt-4">
        <RegionsSettingsTab />
      </TabsContent>
      <TabsContent value="security" className="mt-4">
        <SecurityTab />
      </TabsContent>
      <TabsContent value="system" className="mt-4">
        <Card>
          <CardHeader><CardTitle className="text-base">System Information</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Application</span>
              <span className="font-medium">Illume Student Advisory Services</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Version</span>
              <Badge variant="secondary">1.0.0</Badge>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Framework</span>
              <span className="font-medium">Next.js 14 (App Router)</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Database</span>
              <span className="font-medium">PostgreSQL (Prisma ORM)</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Environment</span>
              <Badge variant="outline">{nodeEnv}</Badge>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
