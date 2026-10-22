using System;
using System.Linq;
using System.Windows.Forms;
using KeePassLib;
using KeePassFerry.Models.DataExchange;
using KeePassFerry.Models.Shared;
using KeePassFerry.Properties;

namespace KeePassFerry.Forms
{
    public partial class KeeFieldForm : Form
    {
        public new string Name;
        public string Value;
        public string Id;
        public FieldType Type;
        public int Page;
        public PlaceholderHandling PlaceholderHandling;
        public string HtmlType;
        public string QuerySelector;

        public static KeeFieldForm FromField(Field field)
        {
            var customFmc = field.MatcherConfigs != null ? field.MatcherConfigs.FirstOrDefault(fmc => fmc != null && (fmc.MatcherType == null || fmc.MatcherType.GetValueOrDefault(FieldMatcherType.Custom) == FieldMatcherType.Custom)) : null;
            string id = "";
            string name = "";
            string htmlType = "";
            string querySelector = "";
            if (customFmc != null)
            {
                var cmId = customFmc.CustomMatcher != null && customFmc.CustomMatcher.Ids != null ? customFmc.CustomMatcher.Ids.FirstOrDefault() : null;
                var cmName = customFmc.CustomMatcher != null && customFmc.CustomMatcher.Names != null ? customFmc.CustomMatcher.Names.FirstOrDefault() : null;
                var cmHtmlType = customFmc.CustomMatcher != null && customFmc.CustomMatcher.Types != null ? customFmc.CustomMatcher.Types.FirstOrDefault() : null;
                var cmQuerySelector = customFmc.CustomMatcher != null && customFmc.CustomMatcher.Queries != null ? customFmc.CustomMatcher.Queries.FirstOrDefault() : null;
                if (cmId != null) id = cmId;
                if (cmName != null) name = cmName;
                if (cmHtmlType != null) htmlType = cmHtmlType;
                if (cmQuerySelector != null) querySelector = cmQuerySelector;
            }

            return new KeeFieldForm(name, field.Value, id, field.Type, field.Page,
                field.PlaceholderHandling.GetValueOrDefault(PlaceholderHandling.Default), field.ValuePath, true,
                htmlType, querySelector);
        }

        public KeeFieldForm(string name, string value, string id, FieldType type, int page, PlaceholderHandling phh,
            string valuePath, bool editing, string htmlType, string querySelector)
        {
            InitializeComponent();
            FerryText.Localize(this);
            // Erklärung statt Link (früher Kee-Forum)
            linkLabel1.LinkArea = new LinkArea(0, 0);
            Icon = Resources.KPRPCico;
            Text = FerryText.L(editing ? "Edit a form field" : "Add a form field");

            comboBox1.Text = Utilities.FieldTypeToDisplay(type, true);
            if (valuePath == PwDefs.UserNameField)
            {
                textBox2.Text = Value = value;
                comboBox1.Enabled = false;
                label6.Visible = true;
            }
            else if (valuePath == PwDefs.PasswordField)
            {
                textBox2.Text = Value = value;
                comboBox1.Enabled = false;
                label7.Visible = true;
            }
            else
            {
                if (type == FieldType.Toggle)
                {
                    checkBox1.Visible = true;
                    Value = value;
                    checkBox1.Checked = Value == "KEEFOX_CHECKED_FLAG_TRUE" ? true : false;
                }
                else
                {
                    textBox2.Text = Value = value;
                    textBox2.Visible = true;
                    label2.Visible = true;
                }
            }

            textBox1.Text = Name = name;
            textBox3.Text = Id = id;
            Page = page;
            textBox4.Text = Page.ToString();
            textBox5.Text = QuerySelector = querySelector;
            textBox6.Text = HtmlType = htmlType;

            switch (phh)
            {
                case PlaceholderHandling.Default:
                    radioButton1.Checked = true;
                    break;
                case PlaceholderHandling.Enabled:
                    radioButton2.Checked = true;
                    break;
                case PlaceholderHandling.Disabled:
                    radioButton3.Checked = true;
                    break;
            }

            comboBox1.SelectedIndexChanged += comboBox1_SelectedIndexChanged;
        }

        private void button1_Click(object sender, EventArgs e)
        {
            if (textBox2.Visible && textBox2.Text.Length <= 0)
            {
                MessageBox.Show(this, FerryText.L("Please specify a value"), "KeePassFerry");
                DialogResult = DialogResult.None;
                return;
            }

            //TODO: Review in 2024/25 to see if we can remove this restriction after the migration to config v2
            if (textBox2.Visible && (textBox2.Text == "{USERNAME}" || textBox2.Text == "{PASSWORD}"))
            {
                MessageBox.Show(this,
                    FerryText.L("Please change the value of this form field. {USERNAME} and {PASSWORD} are reserved for internal use by KeePassFerry."), "KeePassFerry");
                DialogResult = DialogResult.None;
                return;
            }

            Name = textBox1.Text;
            Id = textBox3.Text;
            QuerySelector = textBox5.Text;
            HtmlType = textBox6.Text;
            if (!int.TryParse(textBox4.Text, out Page)) Page = 1;
            if (comboBox1.Text == FerryText.L("Password"))
                Type = FieldType.Password;
            else if (comboBox1.Text == FerryText.L("Existing"))
                Type = FieldType.Existing;
            else if (comboBox1.Text == FerryText.L("Text"))
                Type = FieldType.Text;
            else if (comboBox1.Text == FerryText.L("Toggle"))
                Type = FieldType.Toggle;

            if (comboBox1.Text == FerryText.L("Toggle"))
            {
                Value = checkBox1.Checked ? "KEEFOX_CHECKED_FLAG_TRUE" : "KEEFOX_CHECKED_FLAG_FALSE";
            }
            else
            {
                Value = textBox2.Text;
            }

            if (radioButton1.Checked) PlaceholderHandling = PlaceholderHandling.Default;
            if (radioButton2.Checked) PlaceholderHandling = PlaceholderHandling.Enabled;
            if (radioButton3.Checked) PlaceholderHandling = PlaceholderHandling.Disabled;
        }

        private void comboBox1_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (comboBox1.Text == FerryText.L("Toggle"))
            {
                textBox2.Visible = false;
                label2.Visible = false;
                checkBox1.Visible = true;
                checkBox1.Checked = false;
            }
            else
            {
                textBox2.Visible = true;
                label2.Visible = true;
                checkBox1.Visible = false;
                checkBox1.Checked = false;
            }
        }
    }
}