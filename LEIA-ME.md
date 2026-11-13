# Estoque da Elétrica — EPC13

Na conta proprietária autorizada, escolha Entrar, use o login admin e a senha configurada no servidor em STOCK_ADMIN_PASSWORD. O perfil administrativo é criado automaticamente no primeiro login. Outros visitantes autorizados usam seu e-mail e senha pessoal após criar cadastro.

Visitantes autorizados no compartilhamento privado podem solicitar cadastro. O administrador aprova ou recusa pela aba Cadastros. Até a aprovação, o estoque fica inacessível. Perfis já aprovados podem ser bloqueados ou liberados.

## Excel

Baixe o modelo no painel, preencha uma linha por material e mantenha as colunas da primeira linha. Use texto para referências com zeros à esquerda. Unidades aceitas: un, m, cx, rl e par. Use números positivos ou zero para saldo e mínimo. Salve em .xlsx, clique em Importar .xlsx e confirme a quantidade. Até 2.000 linhas e 5 MB por arquivo. Referências existentes ou repetidas impedem a inclusão do lote inteiro. Exportar estoque gera uma planilha com saldos, mínimos e situação.

## Código-fonte e hospedagem

Este projeto usa React, Vinext, Workers e D1 no ambiente Sites. Instale as dependências com npm ci e compile com npm run build. O banco usa as migrações do diretório drizzle, em ordem. Para uma implantação própria, configure o banco DB e a variável de servidor STOCK_OWNER_EMAIL com o e-mail da conta proprietária. A autenticação depende do gateway privado do Sites, que fornece a identidade verificada do visitante. Em outro provedor, substitua essa integração antes de expor o aplicativo. O ZIP contém o código, sem senhas ou cópia do banco de estoque.
