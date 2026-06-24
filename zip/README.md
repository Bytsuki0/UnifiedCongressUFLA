# 🎓 Sistema de Gestão de Eventos Acadêmicos

Sistema desenvolvido para auxiliar na organização e gerenciamento de eventos acadêmicos, centralizando processos de inscrição, programação, controle de presença e emissão automatizada de certificados.

---

## 📖 Sobre o Projeto

A organização de eventos acadêmicos geralmente envolve diversas atividades administrativas realizadas manualmente ou por meio de ferramentas desconectadas, o que pode gerar retrabalho, inconsistências nos dados e dificuldades no gerenciamento das informações.

Com o objetivo de solucionar esse problema, este projeto propõe o desenvolvimento de uma plataforma integrada capaz de automatizar e centralizar as principais atividades relacionadas à gestão de congressos, seminários, simpósios, palestras e minicursos.

A aplicação busca proporcionar maior eficiência para organizadores e uma melhor experiência para participantes, reduzindo processos manuais e aumentando a confiabilidade das informações.

---

## 🎯 Objetivos

- Centralizar informações do evento em uma única plataforma;
- Automatizar processos administrativos;
- Facilitar inscrições em eventos e minicursos;
- Gerenciar a programação das atividades;
- Realizar controle de presença via QR Code;
- Emitir certificados automaticamente;
- Melhorar a experiência dos usuários;
- Reduzir retrabalho e erros operacionais.

---

## 🚀 Funcionalidades

### 👤 Participantes

- Cadastro de usuários
- Login e autenticação
- Inscrição no congresso
- Inscrição em minicursos
- Visualização da programação
- Consulta de certificados emitidos

### 👨‍💼 Organizadores

- Gerenciamento de participantes
- Controle de inscrições
- Cadastro de palestras
- Cadastro de minicursos
- Controle da programação
- Registro de presença
- Emissão de certificados

### 📜 Certificados

O sistema contempla a emissão automática dos seguintes certificados:

#### Participação

- Participação no congresso
- Participação em minicursos

#### Apresentação de Trabalhos

- Apresentação de trabalho científico

#### Premiação Científica

- Melhor Artigo – Pesquisa
- Melhor Artigo – BIC Jr.
- Melhor Artigo – Ensino
- Melhor Artigo – Extensão

#### Revisores

- Certificado de Revisor
- Certificado de Melhor Revisor

#### Ministrantes

- Certificado de Ministrante de Minicurso
- Certificado de Palestrante

---

## 🏗️ Arquitetura Geral

```text
Sistema
│
├── Autenticação
│   ├── Login
│   └── Cadastro
│
├── Participantes
│   ├── Inscrição no Congresso
│   ├── Inscrição em Minicursos
│   └── Certificados
│
├── Programação
│   ├── Palestras
│   ├── Minicursos
│   └── Cronograma
│
├── Presença
│   └── QR Code
│
└── Certificação
    ├── Participação
    ├── Apresentação
    ├── Revisão
    ├── Premiação
    └── Ministrantes
```

---

## 🛠️ Tecnologias Utilizadas

### Front-end

- React
- TypeScript
- Vite

### Back-end

- Firebase Authentication
- Firebase Firestore
- Firebase Storage

### Ferramentas

- Git
- GitHub
- Figma
- Notion

---

## 📊 Metodologia de Desenvolvimento

O projeto é desenvolvido utilizando metodologias ágeis, com foco no framework Scrum.

As atividades são organizadas em Sprints e acompanhadas através de um quadro Kanban dividido em:

- To Do
- Doing
- Done

Essa abordagem permite:

- Maior organização das tarefas;
- Melhor acompanhamento das entregas;
- Evolução incremental do sistema;
- Adaptação rápida às mudanças.

---

## 📅 Roadmap

### Sprint 1
- Levantamento de requisitos
- Definição dos fluxos do sistema
- Planejamento inicial

### Sprint 2
- Desenvolvimento dos protótipos
- Estruturação do Kanban
- Modelagem dos fluxos

### Sprint 3
- Início da implementação
- Configuração do Firebase
- Desenvolvimento das telas principais

### Próximas Sprints
- Integração completa dos módulos
- Controle de presença via QR Code
- Emissão automática de certificados
- Testes de usabilidade
- Deploy da aplicação

---

## 🚧 Status do Projeto

**Em Desenvolvimento**

Atualmente o sistema encontra-se em fase de implementação e evolução contínua.

Funcionalidades concluídas e em desenvolvimento podem ser acompanhadas através do gerenciamento das Sprints do projeto.

---

## 👥 Equipe

- Bianca Lara Nunes
- Kauã Winycyus Souza Silva
- Lucas Eduardo de Carvalho Ferreira
- Ruby Novaes Marshall

---

## 🎓 Contexto Acadêmico

Projeto desenvolvido na disciplina:

**Processo de Desenvolvimento de Software**

**Universidade Federal de Lavras (UFLA)**  
Campus São Sebastião do Paraíso

---

## 📄 Licença

Este projeto possui finalidade exclusivamente acadêmica e educacional.
