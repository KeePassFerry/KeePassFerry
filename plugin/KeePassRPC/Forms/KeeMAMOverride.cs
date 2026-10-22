using System;
using System.Collections.Generic;
using System.Windows.Forms;
using DomainPublicSuffix;
using KeePassFerry.Properties;

namespace KeePassFerry.Forms
{
    public partial class KeeMAMOverrideForm : Form
    {
        public string Domain;
        public MatchAccuracyMethod MAM;
        public List<string> OtherKeys;

        public KeeMAMOverrideForm(string domain, MatchAccuracyMethod? mam, List<string> otherKeys)
        {
            InitializeComponent();
            FerryText.Localize(this);
            Icon = Resources.FerryIcon;
            Domain = domain;
            OtherKeys = otherKeys;
            MAM = mam.GetValueOrDefault(MatchAccuracyMethod.Domain);

            textBox1.Text = Domain;

            switch (MAM)
            {
                case MatchAccuracyMethod.Exact: radioButton3.Checked = true; break;
                case MatchAccuracyMethod.Hostname: radioButton2.Checked = true; break;
                case MatchAccuracyMethod.Domain: radioButton1.Checked = true; break;
            }

            if (string.IsNullOrEmpty(domain))
                Text = FerryText.L("Add Override");
            else
                Text = FerryText.L("Edit Override");
        }

        private void buttonOK_Click(object sender, EventArgs e)
        {
            if (textBox1.Text.Length > 0)
                Domain = textBox1.Text;
            else
                DialogResult = DialogResult.None;

            if (OtherKeys.Contains(Domain))
            {
                MessageBox.Show(this, string.Format(FerryText.L("An override for '{0}' has already been added. Cancel, then find and Edit the existing override."), Domain), "KeePassFerry");
                DialogResult = DialogResult.None;
                return;
            }

            DomainName domain;
            DomainName.TryParse(Domain, out domain);
            if (domain == null || domain.RegistrableDomain == null || domain.RegistrableDomain != Domain)
            {
                MessageBox.Show(this, FerryText.L("Invalid domain name"), "KeePassFerry");
                DialogResult = DialogResult.None;
                return;
            }

            MAM = DetermineDefaultMatchAccuracy();
        }

        private MatchAccuracyMethod DetermineDefaultMatchAccuracy()
        {
            if (radioButton3.Checked) return MatchAccuracyMethod.Exact;
            if (radioButton2.Checked) return MatchAccuracyMethod.Hostname;
            return MatchAccuracyMethod.Domain;
        }
    }
}
