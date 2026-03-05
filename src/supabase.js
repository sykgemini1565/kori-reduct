// src/supabase.js
import { createClient } from '@supabase/supabase-js';

// 1. Supabase 대시보드 -> 왼쪽 맨 아래 Project Settings (톱니바퀴) -> API 메뉴로 이동합니다.
// 2. Project URL을 복사해서 아래에 넣습니다.
const supabaseUrl = 'https://ytthcicpylfircpmsaai.supabase.co';

// 3. Project API keys 영역에 있는 'anon' (public) 키를 복사해서 아래에 넣습니다.
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0dGhjaWNweWxmaXJjcG1zYWFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Njk5NTIsImV4cCI6MjA4ODI0NTk1Mn0.omuXjkEXc-dyvqMLTfifmFznqxtDjCluYg1KB_NDSCc';

// 클라이언트를 생성해서 밖으로 내보냅니다.
export const supabase = createClient(supabaseUrl, supabaseKey);